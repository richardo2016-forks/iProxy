import exitHook from 'exit-hook';
import spwan from 'cross-spawn';
import { ipcMain } from 'electron-better-ipc';
import logger from 'electron-log';

import { BoardcastManager } from './boradcast-manager';
import { checkSystemProxyWork, setSystemProxy } from './platform';
import checkInstallStatus from './install';
import treeKill from 'tree-kill';
import ip from 'ip';
import { checkUpdater } from './updater';
import Koa from 'koa';
import KoaStatic from 'koa-static';
import electronIsDev from 'electron-is-dev';
import path from 'path';
import { LIGHTPROXY_FILES_DIR } from './const';
import { app } from 'electron';

interface SwpanModuleProp {
    moduleId: string;
    env: any;
    keepAlive: boolean;
}
async function checkInstall() {
    await checkInstallStatus();
}
async function spawnModule(props: any) {
    const { moduleId, env = {} } = props as SwpanModuleProp;
    logger.info('spawn module', moduleId);
    const boardcastPort = (await BoardcastManager.getInstance()).getPort();

    logger.info('boardcast port', boardcastPort);

    const nodeModulePath = path.join(LIGHTPROXY_FILES_DIR, `/node/node_modules/`);
    const modulePath = encodeURIComponent(path.join(nodeModulePath, `${moduleId}/index.js`));

    const nodeScript = `
const cp = require('child_process');
const originSpwan = cp.spawn;

// @ts-ignore
cp.spawn = function(cmd, argv, options) {
    if (cmd === 'node' || cmd === 'node.exe') {
        cmd = process.execPath;
        options = options || {};
        options.env = options.env || {};
        options.env.ELECTRON_RUN_AS_NODE = '1';
    }

    return originSpwan.call(this, cmd, argv, options);
};
require(decodeURIComponent('${modulePath}'));`;
    const startProcess = () => {
        const child = spwan(
            process.execPath,
            [
                '-e',
                `const code = decodeURIComponent("${encodeURIComponent(nodeScript)}");console.log(code);eval(code);`,
                '--tls-min-v1.0',
                '--max-http-header-size=256000',
            ],
            {
                env: {
                    ...process.env,
                    ...env,
                    ELECTRON_RUN_MODULE: moduleId,
                    LIGHTPROXY_BOARDCASR_PORT: boardcastPort,
                    USER_DATA: app.getPath('appData'),
                    NODE_PATH: nodeModulePath,
                    ELECTRON_RUN_AS_NODE: 1,
                },
            },
        );
        logger.info('Spwaned process', process.execPath, child.pid);

        exitHook(() => {
            child.kill();
        });

        child?.stderr?.on('data', data => {
            logger.error(`[pid ${child.pid}]stderr: ${data.toString()}`);
        });

        child?.stdout?.on('data', data => {
            logger.info(`[pid ${child.pid}]stdout: ${data.toString()}`);
        });

        return child.pid;
    };

    return startProcess();
}

async function getBoradcastPort() {
    const instance = await BoardcastManager.getInstance();
    return instance.getPort();
}

async function treeKillProcess(pid: any) {
    treeKill(pid);
}

async function getIp() {
    return ip.address();
}

async function update() {
    return checkUpdater();
}

let server: any;

async function getStaticServePath() {
    if (!server) {
        const app = new Koa();
        const staticPath = electronIsDev ? path.join(__dirname, '../../') : path.join(__dirname, './');
        logger.info('static path', staticPath);
        app.use(KoaStatic(staticPath));
        server = app.listen();
    }
    // @ts-ignore
    const port = server.address()?.port;
    return `http://127.0.0.1:${port}`;
}

async function checkSystemProxy(props: any) {
    const { port, address } = props;
    return checkSystemProxyWork(address, port);
}

export async function initIPC() {
    // ipcMain
    ipcMain.answerRenderer('spawnModule', spawnModule);
    ipcMain.answerRenderer('checkInstall', checkInstall);

    ipcMain.answerRenderer('getBoradcastPort', getBoradcastPort);
    // @ts-ignore
    ipcMain.answerRenderer('setSystemProxy', setSystemProxy);

    ipcMain.answerRenderer('treeKillProcess', treeKillProcess);

    ipcMain.answerRenderer('getIp', getIp);
    ipcMain.answerRenderer('update', update);
    ipcMain.answerRenderer('getStaticServePath', getStaticServePath);

    ipcMain.answerRenderer('checkSystemProxy', checkSystemProxy);

    // start a socketIO server for extension background process
    await BoardcastManager.getInstance();

    exitHook(async () => {
        await setSystemProxy(0);
    });
}
