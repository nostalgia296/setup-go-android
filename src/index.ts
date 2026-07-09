import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';

const abiMap: Record < string, {
    goarch: string;
    clang: string;
} > = {
    'arm64-v8a': {
        goarch: 'arm64',
        clang: 'aarch64-linux-android'
    },
    'armeabi-v7a': {
        goarch: 'arm',
        clang: 'armv7a-linux-androideabi'
    },
    'x86_64': {
        goarch: 'amd64',
        clang: 'x86_64-linux-android'
    },
    'x86': {
        goarch: '386',
        clang: 'i686-linux-android'
    }
};

async function run(): Promise < void > {
    try {
        const ndkVersion = core.getInput('ndk-version', {
            required: true
        });
        const goVersion = core.getInput('go-version', {
            required: true
        });
        const abi = core.getInput('abi', {
            required: true
        });
        const minSdk = core.getInput('min-sdk') || '21';
        const gitRepo = core.getInput('gitrepo');
        const cmd = core.getInput('cmd');
        const branch = core.getInput('branch') || 'main';
        const workdir = process.env.GITHUB_WORKSPACE || process.cwd();

        const mapped = abiMap[abi];
        if (!mapped) throw new Error(`Unsupported ABI: ${abi}`);

        core.info(`Setting up Go ${goVersion} for Android ${abi} (min SDK ${minSdk})`);

        await setupGo(goVersion);
        await setupNDK(workdir, ndkVersion);

        const ndkPath = path.join(workdir, ndkVersion);
        const binPath = path.join(ndkPath, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin');
        const ccPath = path.join(binPath, `${mapped.clang}${minSdk}-clang`);

        core.exportVariable('CGO_ENABLED', '1');
        core.exportVariable('GOOS', 'android');
        core.exportVariable('GOARCH', mapped.goarch);
        core.exportVariable('CC', ccPath);
        core.exportVariable('CGO_CFLAGS', '-fPIC');
        core.addPath(binPath);

        core.setOutput('ndk-path', ndkPath);
        core.setOutput('cc-path', ccPath);

        await verifyInstallation(ccPath);
        core.info('Go Android environment setup complete');

        let repoPath = '';
        if (gitRepo) {
            repoPath = await cloneRepo(workdir, gitRepo, branch);
            core.setOutput('repo-path', repoPath);
        }

        if (cmd) {
            const cwd = repoPath || workdir;
            await runCommand(cmd, cwd);
        }

    } catch (error) {
        core.setFailed(error instanceof Error ? error.message : 'Unknown error');
    }
}

async function setupGo(version: string): Promise < void > {
    core.info(`Installing Go ${version}...`);

    try {
        const platform = process.platform;
        const arch = process.arch === 'x64' ? 'amd64' : process.arch;
        const ext = '.tar.gz';
        //action的ubuntu自带一个go版本,可能会影响到查找新的go，先移除掉。
        //以防万一把新的go链接到/usr/bin/go
        try {
            await runCommand('test -L /usr/bin/go', process.cwd());
            await runCommand('sudo rm -f /usr/bin/go', process.cwd());
            core.info('Removed existing /usr/bin/go symlink');
        } catch (error) {
            core.info('/usr/bin/go does not exist, skipping removal');
        }

        const url = `https://go.dev/dl/go${version}.${platform}-${arch}${ext}`;
        core.debug(`Downloading from: ${url}`);

        const downloadPath = await tc.downloadTool(url);
        const extractPath = await tc.extractTar(downloadPath);

        const goRootPath = path.join(extractPath, 'go');
        const toolPath = await tc.cacheDir(goRootPath, 'go', version);

        core.addPath(path.join(toolPath, 'bin'));
        core.exportVariable('GOROOT', toolPath);

        const goBinaryPath = path.join(toolPath, 'bin', 'go');
        await runCommand(`sudo ln -sf ${goBinaryPath} /usr/bin/go`, process.cwd());
        core.info(`Created symlink: /usr/bin/go -> ${goBinaryPath}`);

        core.info(`Go ${version} installed successfully`);
    } catch (error) {
        core.setFailed(`Failed to install Go: ${(error as Error).message}`);
        throw error;
    }
}


async function setupNDK(workdir: string, ndkVersion: string): Promise < void > {
    const zipFile = `${ndkVersion}-linux.zip`;
    const downloadUrl = `https://dl.google.com/android/repository/${zipFile}`;
    const zipPath = path.join(workdir, zipFile);
    const ndkDir = path.join(workdir, ndkVersion);

    if (fs.existsSync(ndkDir)) {
        core.info('NDK already exists, skipping download');
        return;
    }

    core.info(`Downloading Android NDK ${ndkVersion}...`);
    await exec.exec('curl', ['-L', downloadUrl, '--output', zipPath]);

    core.info('Extracting NDK...');
    await exec.exec('unzip', ['-q', zipPath, '-d', workdir]);
    await io.rmRF(zipPath);

    core.info('NDK installed');
}

async function cloneRepo(workdir: string, repoUrl: string, branch: string): Promise < string > {
    core.info(`Cloning repository: ${repoUrl} (branch: ${branch})`);

    // Extract repo name from URL
    const repoName = path.basename(repoUrl, '.git');
    const targetPath = path.join(workdir, repoName);

    // Remove existing directory if it exists
    if (fs.existsSync(targetPath)) {
        core.info(`Removing existing directory: ${targetPath}`);
        await io.rmRF(targetPath);
    }

    await exec.exec('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, targetPath]);

    core.info(`Repository cloned to: ${targetPath}`);
    return targetPath;
}

async function runCommand(cmd: string, cwd: string): Promise < void > {
    core.info(`Running command in ${cwd}: ${cmd}`);

    const options = {
        cwd: cwd,
        env: process.env as {
            [key: string]: string
        }
    };

    await exec.exec('bash', ['-c', cmd], options);

    core.info('Command executed successfully');
}

async function verifyInstallation(ccPath: string): Promise < void > {
    core.info('Verifying installation...');

    if (!fs.existsSync(ccPath)) {
        throw new Error(`Compiler not found at ${ccPath}`);
    }

    for (const env of ['CGO_ENABLED', 'GOOS', 'GOARCH', 'CC', 'CGO_CFLAGS']) {
        if (!process.env[env]) {
            core.warning(`Environment variable ${env} is not set`);
        }
    }

    try {
        await exec.exec('go', ['version']);
    } catch {
        core.warning('Go version check failed');
    }
}

run();