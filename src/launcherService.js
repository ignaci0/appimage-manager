import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { log, logError } from './logger.js';

export class LauncherService {
    constructor() { }

    _getDesktopDir() {
        const desktopDir = Gio.File.new_for_path(GLib.build_pathv('/', [GLib.get_user_data_dir(), 'applications']));
        if (!desktopDir.query_exists(null)) {
            desktopDir.make_directory_with_parents(null);
        }
        return desktopDir;
    }

    _getDesktopFilePath(appImageName) {
        const desktopDir = this._getDesktopDir();
        return GLib.build_pathv('/', [desktopDir.get_path(), `${appImageName}.desktop`]);
    }

    createLauncher(appImageMetadata) {
        log(`Creating launcher for ${appImageMetadata.name} with icon: ${appImageMetadata.icon}`);
        let desktopFilePath = this._getDesktopFilePath(appImageMetadata.name);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);

        let content = `[Desktop Entry]
# Created by AppImage Manager
Name=${appImageMetadata.name}
Exec=${appImageMetadata.path}
Icon=${appImageMetadata.icon || 'application-x-appimage'}
Terminal=false
Type=Application
Categories=${appImageMetadata.categories ? appImageMetadata.categories.join(';') + ';' : 'Utility;'}
StartupNotify=true
`;

        let encoder = new TextEncoder();
        let bytes = new GLib.Bytes(encoder.encode(content));

        desktopFile.replace_contents_bytes_async(
            bytes,
            null, // etag
            false, // make_backup
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null, // cancellable
            (file, res) => {
                try {
                    file.replace_contents_finish(res);
                    log(`Created launcher for ${appImageMetadata.name} at ${desktopFilePath}`);
                } catch (e) {
                    logError(`Failed to create launcher for ${appImageMetadata.name}: ${e.message}`);
                }
            }
        );
        return desktopFilePath;
    }

    deleteLauncher(appImageName) {
        let desktopFilePath = this._getDesktopFilePath(appImageName);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);

        if (desktopFile.query_exists(null)) {
            try {
                desktopFile.delete(null);
                log(`Deleted launcher for ${appImageName} at ${desktopFilePath}`);
                return true;
            } catch (e) {
                logError(`Failed to delete launcher for ${appImageName}: ${e.message}`);
                return false;
            }
        }
        return false;
    }
}
