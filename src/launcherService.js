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

    _hasLibfuse2() {
        const paths = [
            '/lib/x86_64-linux-gnu/libfuse.so.2',
            '/usr/lib/x86_64-linux-gnu/libfuse.so.2',
            '/lib64/libfuse.so.2',
            '/usr/lib64/libfuse.so.2',
            '/usr/lib/libfuse.so.2',
            '/lib/libfuse.so.2',
            '/lib/aarch64-linux-gnu/libfuse.so.2',
            '/usr/lib/aarch64-linux-gnu/libfuse.so.2'
        ];
        for (const p of paths) {
            try {
                let file = Gio.File.new_for_path(p);
                if (file.query_exists && file.query_exists(null)) {
                    return true;
                }
            } catch (e) {
                // Ignore
            }
        }
        return false;
    }

    _patchDesktopContent(content, appPath, iconPath) {
        let lines = content.split('\n');
        let hasExec = false;
        let hasIcon = false;
        let hasDesktopEntryHeader = false;
        const needExtractAndRun = !this._hasLibfuse2();

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            if (line.trim() === '[Desktop Entry]') {
                hasDesktopEntryHeader = true;
            }

            if (line.startsWith('Exec=')) {
                let match = line.match(/^Exec=\s*(["']?)([^\s"']+)(["']?)(.*)$/);
                let extraArgs = match ? match[4] : '';
                if (needExtractAndRun && !extraArgs.includes('--appimage-extract-and-run')) {
                    lines[i] = `Exec="${appPath}" --appimage-extract-and-run${extraArgs}`;
                } else {
                    lines[i] = `Exec="${appPath}"${extraArgs}`;
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
            let execCmd = needExtractAndRun ? `"${appPath}" --appimage-extract-and-run` : `"${appPath}"`;
            lines.push(`Exec=${execCmd}`);
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
            const needExtractAndRun = !this._hasLibfuse2();
            const execCmd = needExtractAndRun ? `"${appImageMetadata.path}" --appimage-extract-and-run` : `"${appImageMetadata.path}"`;
            content = `[Desktop Entry]
# Created by AppImage Manager
Name=${appImageMetadata.name}
Exec=${execCmd}
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

    async isLauncherUpToDate(appImageMetadata) {
        let appImageName = typeof appImageMetadata === 'string' ? appImageMetadata : appImageMetadata?.name;
        if (!appImageName) {
            return false;
        }
        let desktopFilePath = this._getDesktopFilePath(appImageName);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);
        if (!desktopFile.query_exists(null)) {
            return false;
        }
        try {
            const contents = await new Promise((resolve) => {
                desktopFile.load_contents_async(null, (file, res) => {
                    try {
                        let [ok, contents] = file.load_contents_finish(res);
                        if (ok && contents) {
                            resolve(contents);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            if (contents) {
                let decoder = new TextDecoder('utf-8');
                let contentStr = decoder.decode(contents);
                let lines = contentStr.split('\n');
                let iconValid = false;
                let execValid = true;
                let tryExecValid = true;

                const needExtractAndRun = !this._hasLibfuse2();
                const expectedPath = typeof appImageMetadata === 'object' ? appImageMetadata.path : null;

                for (let line of lines) {
                    if (line.startsWith('Icon=')) {
                        let iconVal = line.substring(5).trim();
                        if (iconVal && iconVal !== 'application-x-appimage') {
                            iconValid = true;
                        }
                    }
                    if (line.startsWith('Exec=')) {
                        if (needExtractAndRun && !line.includes('--appimage-extract-and-run')) {
                            execValid = false;
                        }
                    }
                    if (line.startsWith('TryExec=')) {
                        let tryExecVal = line.substring(8).trim();
                        if (expectedPath && tryExecVal !== expectedPath) {
                            tryExecValid = false;
                        }
                    }
                }
                return iconValid && execValid && tryExecValid;
            }
        } catch (e) {
            // Ignore error
        }
        return false;
    }

    async hasValidIcon(appImageName) {
        let desktopFilePath = this._getDesktopFilePath(appImageName);
        let desktopFile = Gio.File.new_for_path(desktopFilePath);
        if (!desktopFile.query_exists(null)) {
            return false;
        }
        try {
            const contents = await new Promise((resolve) => {
                desktopFile.load_contents_async(null, (file, res) => {
                    try {
                        let [ok, contents] = file.load_contents_finish(res);
                        if (ok && contents) {
                            resolve(contents);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            if (contents) {
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
