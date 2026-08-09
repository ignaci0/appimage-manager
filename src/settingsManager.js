import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class SettingsManager {
    constructor(extension) {
        this._settings = extension.getSettings();
    }

    getMonitoredDirectory() {
        let storedPath = this._settings.get_string('monitored-directory');
        if (!storedPath) {
            return GLib.build_pathv('/', [GLib.get_home_dir(), 'Applications']);
        }
        return storedPath;
    }

    setMonitoredDirectory(directoryPath) {
        this._settings.set_string('monitored-directory', directoryPath);
    }

    getDeepIconSearch() {
        return this._settings.get_boolean('deep-icon-search');
    }

    setDeepIconSearch(enabled) {
        this._settings.set_boolean('deep-icon-search', enabled);
    }
}