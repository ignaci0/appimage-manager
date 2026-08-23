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

    _patchDesktopContent(content, appPath, iconPath) {
        let lines = content.split('\n');
        let hasExec = false;
        let hasIcon = false;
        let hasDesktopEntryHeader = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            if (line.trim() === '[Desktop Entry]') {
                hasDesktopEntryHeader = true;
            }

            if (line.startsWith('Exec=')) {
                let match = line.match(/^Exec=\s*(["']?)([^\s"']+)(["']?)(.*)$/);
                if (match) {
                    lines[i] = `Exec="${appPath}"${match[4]}`;
                } else {
                    lines[i] = `Exec="${appPath}"`;
                }
                hasExec = true;
            } else if (line.startsWith('TryExec=')) {
                lines[i] = `TryExec=${appPath}`;
            } else if (line.startsWith('Icon=')) {
                lines[i] = `Icon=${iconPath || 'application-x-appimage'}`;
                hasIcon = true;
            }
        }

        // If headers/fields are missing, safely append them
        if (!hasExec) {
            lines.push(`Exec="${appPath}"`);
        }
        if (!hasIcon) {
            lines.push(`Icon=${iconPath || 'application-x-appimage'}`);
        }

        let patchedContent = lines.join('\n');
        if (!hasDesktopEntryHeader) {
            patchedContent = '[Desktop Entry]\n' + patchedContent;
        }
        
        return patchedContent;
    }

    createLauncher(appImageMetadata) {
        log(`Creating launcher for ${appImageMetadata.name} with icon: ${appImageMetadata.icon}`);
        let desktopFilePath = this._getDesktopFilePath(appImageMetadata.name);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);

        let content;
        if (appImageMetadata.desktopContent) {
            content = this._patchDesktopContent(
                appImageMetadata.desktopContent,
                appImageMetadata.path,
                appImageMetadata.icon
            );
        } else {
            content = `[Desktop Entry]
# Created by AppImage Manager
Name=${appImageMetadata.name}
Exec=${appImageMetadata.path}
Icon=${appImageMetadata.icon || 'application-x-appimage'}
Terminal=false
Type=Application
Categories=${appImageMetadata.categories ? appImageMetadata.categories.join(';') + ';' : 'Utility;'}
StartupNotify=true
`;
        }

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

    launcherExists(appImageName) {
        let desktopFilePath = this._getDesktopFilePath(appImageName);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);
        return desktopFile.query_exists(null);
    }

    hasValidIcon(appImageName) {
        let desktopFilePath = this._getDesktopFilePath(appImageName);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);
        if (!desktopFile.query_exists(null)) {
            return false;
        }
        try {
            let [ok, contents] = desktopFile.load_contents(null);
            if (ok && contents) {
                let decoder = new TextDecoder('utf-8');
                let contentStr = decoder.decode(contents);
                for (let line of contentStr.split('\n')) {
                    if (line.startsWith('Icon=')) {
                        let iconVal = line.substring(5).trim();
                        if (iconVal && iconVal !== 'application-x-appimage') {
                            return true;
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore error
        }
        return false;
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
