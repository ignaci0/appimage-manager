import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {FileMonitor} from './fileMonitor.js';
import {AppImageManager} from './appImageManager.js';
import {LauncherService} from './launcherService.js';
import {SettingsManager} from './settingsManager.js';
import { log, logError } from './logger.js';

export default class AppImageManagerExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    async enable() {
        log(`Enabling ${this.metadata.name} extension`);

        this._settingsManager = new SettingsManager(this);
        this._fileMonitor = new FileMonitor();
        this._appImageManager = new AppImageManager(this._fileMonitor);
        this._launcherService = new LauncherService();

        let monitoredDirectory = this._settingsManager.getMonitoredDirectory();

        try {
            await this._appImageManager.rescan(monitoredDirectory);
        } catch (e) {
            logError(`Rescan failed: ${e?.message ?? e}`);
        }

        const started = this._fileMonitor.startMonitoring(
            monitoredDirectory,
            (filePath) => {
                this._appImageManager.addAppImage(filePath).catch(err => logError(err));
            },
            (filePath) => {
                this._appImageManager.removeAppImage(filePath).catch(err => logError(err));
            }
        );
        if (!started)
            logError(`Failed to monitor directory: ${monitoredDirectory}`);
    }

    disable() {
        log(`Disabling ${this.metadata.name} extension`);
        this._fileMonitor?.stopMonitoring();

        let monitoredDirectory = this._settingsManager.getMonitoredDirectory();
        let dir = Gio.File.new_for_path(monitoredDirectory);
        if (dir.query_exists(null)) {
            try {
                let enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null)) !== null) {
                    let child = dir.get_child(fileInfo.get_name());
                    if (fileInfo.get_file_type() === Gio.FileType.REGULAR && this._appImageManager.isAppImage(child.get_path())) {
                        let fileName = GLib.path_get_basename(child.get_path());
                        let appImageName = fileName.replace(/\.AppImage$/, '');
                        this._launcherService.deleteLauncher(appImageName);
                    }
                }
                enumerator.close(null);
            } catch (e) {
                logError(`Failed to cleanup launchers: ${e?.message ?? e}`);
            }
        }

        this._launcherService = null;
        this._appImageManager = null;
        this._fileMonitor = null;
        this._settingsManager = null;
    }
}
