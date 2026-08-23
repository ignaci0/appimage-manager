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
        this._appImageManager = new AppImageManager(this._fileMonitor, this._settingsManager);
        this._launcherService = new LauncherService();

        let monitoredDirectory = this._settingsManager.getMonitoredDirectory();

        await this._appImageManager.rescan(monitoredDirectory);

        this._fileMonitor.startMonitoring(
            monitoredDirectory,
            (filePath) => {
                this._appImageManager.addAppImage(filePath);
            },
            (filePath) => {
                this._appImageManager.removeAppImage(filePath);
            }
        );
    }

    disable() {
        log(`Disabling ${this.metadata.name} extension`);
        if (this._fileMonitor) {
            this._fileMonitor.stopMonitoring();
        }

        this._launcherService = null;
        this._appImageManager = null;
        this._fileMonitor = null;
        this._settingsManager = null;
    }
}
