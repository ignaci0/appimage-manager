import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { LauncherService } from './launcherService.js';
import { log, logError } from './logger.js';
import { CacheManager } from './cacheManager.js';

export class AppImageManager {
    constructor(fileMonitor) {
        this._launcherService = new LauncherService();
        this._fileMonitor = fileMonitor;
        this._cacheManager = new CacheManager();
    }

    async addAppImage(filePath) {
        if (await this._cacheManager.get(filePath)) {
            log(`Skipping already cached AppImage: ${filePath}`);
            return;
        }

        if (!this.isAppImage(filePath)) {
            return;
        }

        this.ensureExecutable(filePath);
        const metadata = await this.extractMetadata(filePath);

        if (this._fileMonitor) {
            this._fileMonitor.pause();
        }

        this._launcherService.createLauncher(metadata);
        await this._cacheManager.add({ path: filePath, name: metadata.name });

        if (this._fileMonitor) {
            this._fileMonitor.resume();
        }
    }

    async removeAppImage(filePath) {
        if (!this.isAppImage(filePath)) {
            return;
        }

        const metadata = await this.extractMetadata(filePath);
        this._launcherService.deleteLauncher(metadata.name);
        await this._cacheManager.remove(filePath);
    }

    isAppImage(filePath) {
        // As per clarification, identify by .AppImage extension
        return filePath.endsWith('.AppImage');
    }

    ensureExecutable(filePath) {
        let file = Gio.File.new_for_path(filePath);
        try {
            let info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
            let mode = info.get_attribute_uint32('unix::mode');

            if (!(mode & 0o100)) {
                mode |= 0o100;
                file.set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
                log(`Made AppImage executable: ${filePath}`);
            }
        } catch (e) {
            logError(`Failed to make AppImage executable: ${e.message}`);
        }
    }

    async extractMetadata(filePath) {
        const extractedMetadata = await this._extractAppImageMetadata(filePath);

        if (!extractedMetadata) {
            // Fallback to old method if metadata extraction fails
            let fileName = GLib.path_get_basename(filePath);
            let name = fileName.replace(/\.AppImage$/, ''); // Remove .AppImage extension
            name = name.replace(/[-._\s](v\d+(\.\d+){1,2}|\d+\.\d+\.\d+).*$/i, '');
            name = name.replace(/[-_.]/g, ' ').trim();
            name = name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            return {
                name: name,
                path: filePath,
                icon: null,
                categories: ['Utility'], // Placeholder
                desktopFilePath: null
            };
        }

        return {
            name: extractedMetadata.name,
            path: filePath,
            icon: extractedMetadata.icon,
            categories: ['Utility'], // Placeholder
            desktopFilePath: null
        };
    }

    async _extractAppImageMetadata(filePath) {
        let tempDir = Gio.File.new_for_path(GLib.build_pathv('/', [GLib.get_tmp_dir(), GLib.uuid_string_random()]));
        tempDir.make_directory_with_parents(null);

        try {
            log(`Extracting ${filePath} to ${tempDir.get_path()}`);
            let command = `${filePath} --appimage-extract`;
            let [success, pid] = GLib.spawn_async(
                tempDir.get_path(),
                ['/bin/sh', '-c', command],
                null,
                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );

            if (!success) {
                logError('Failed to run --appimage-extract');
                return null;
            }

            await new Promise(resolve => {
                GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
                    GLib.spawn_close_pid(pid);
                    log(`Extraction process for ${filePath} finished with status ${status}`);
                    resolve();
                });
            });

            let squashfsRoot = tempDir.get_child('squashfs-root');
            if (!squashfsRoot.query_exists(null)) {
                logError('squashfs-root not found');
                return null;
            }

            const desktopFileMetadata = await this._findAndParseDesktopFile(squashfsRoot);
            const appName = desktopFileMetadata ? desktopFileMetadata.name : null;

            let iconPath = this._findIcon(squashfsRoot, desktopFileMetadata ? desktopFileMetadata.icon : null);
            if (!iconPath) {
                logError('Icon not found in squashfs-root');
                return null;
            }

            let iconFile = Gio.File.new_for_path(iconPath);
            let iconDir = Gio.File.new_for_path(GLib.build_pathv('/', [GLib.get_user_data_dir(), 'icons', 'hicolor', '256x256', 'apps']));
            if (!iconDir.query_exists(null)) {
                iconDir.make_directory_with_parents(null);
            }
            let newIconFile = iconDir.get_child(`${appName}.png`);
            iconFile.copy(newIconFile, Gio.FileCopyFlags.OVERWRITE, null, null);

            return { name: appName, icon: newIconFile.get_path() };
        } finally {
            log(`Deleting directory: ${tempDir.get_path()}`);
            this._deleteDirectoryRecursive(tempDir);
        }
    }

    async _findAndParseDesktopFile(squashfsRoot) {
        let enumerator = squashfsRoot.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        let desktopFile = null;

        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let name = fileInfo.get_name();
            if (name.endsWith('.desktop')) {
                desktopFile = squashfsRoot.get_child(name);
                break;
            }
        }
        enumerator.close(null);

        if (!desktopFile) {
            return null;
        }

        try {
            const contents = await new Promise((resolve, reject) => {
                desktopFile.load_contents_async(null, (file, res) => {
                    try {
                        let [success, contents] = file.load_contents_finish(res);
                        if (success) {
                            resolve(contents);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (!contents) {
                return null;
            }

            const decoder = new TextDecoder('utf-8');
            const contentsStr = decoder.decode(contents);

            let name = null;
            let icon = null;

            for (const line of contentsStr.split('\n')) {
                if (line.startsWith('Name=')) {
                    name = line.substring(5).trim();
                } else if (line.startsWith('Icon=')) {
                    icon = line.substring(5).trim();
                }
            }

            return { name, icon };
        } catch (e) {
            logError(`Failed to read desktop file: ${e.message}`);
            return null;
        }
    }

    _findIcon(squashfsRoot, iconName) {
        if (iconName) {
            let baseName = iconName.replace(/\.[^/.]+$/, ""); // Remove extension

            // Search for the icon by name in the root of the squashfs
            let iconFile = squashfsRoot.get_child(iconName);
            if (iconFile.query_exists(null)) {
                return iconFile.get_path();
            }

            // Search in usr/share/icons
            let usrShareIcons = squashfsRoot.get_child('usr').get_child('share').get_child('icons');
            if (usrShareIcons.query_exists(null)) {
                let hicolorDir = usrShareIcons.get_child('hicolor');
                if (hicolorDir.query_exists(null)) {
                    let themeEnumerator = hicolorDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                    let themeInfo;
                    while ((themeInfo = themeEnumerator.next_file(null)) !== null) {
                        if (themeInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                            let sizeDir = hicolorDir.get_child(themeInfo.get_name());
                            let appsDir = sizeDir.get_child('apps');
                            if (appsDir.query_exists(null)) {
                                let iconFile = appsDir.get_child(`${baseName}.svg`);
                                if (iconFile.query_exists(null)) {
                                    themeEnumerator.close(null);
                                    return iconFile.get_path();
                                }
                                iconFile = appsDir.get_child(`${baseName}.png`);
                                if (iconFile.query_exists(null)) {
                                    themeEnumerator.close(null);
                                    return iconFile.get_path();
                                }
                            }
                        }
                    }
                    themeEnumerator.close(null);
                }
            }
        }

        // Fallback to recursive search
        return this._findIconRecursive(squashfsRoot);
    }

    _findIconRecursive(directory) {
        let enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                let iconPath = this._findIconRecursive(child);
                if (iconPath) {
                    enumerator.close(null);
                    return iconPath;
                }
            } else {
                let name = fileInfo.get_name();
                if (name.endsWith('.png') || name.endsWith('.svg')) {
                    if (name.toLowerCase().includes('icon') || name.toLowerCase().includes('logo')) {
                        enumerator.close(null);
                        return child.get_path();
                    }
                }
            }
        }
        enumerator.close(null);

        // If no icon with 'icon' or 'logo' in the name is found, return the first one
        enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() !== Gio.FileType.DIRECTORY) {
                let name = fileInfo.get_name();
                if (name.endsWith('.png') || name.endsWith('.svg')) {
                    enumerator.close(null);
                    return child.get_path();
                }
            }
        }
        enumerator.close(null);

        return null;
    }

    _deleteDirectoryRecursive(directory) {
        let enumerator;
        try {
            enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            logError(`Failed to enumerate children of ${directory.get_path()}: ${e.message}`);
            return;
        }

        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                this._deleteDirectoryRecursive(child);
            } else {
                try {
                    child.delete(null);
                } catch (e) {
                    logError(`Failed to delete file ${child.get_path()}: ${e.message}`);
                }
            }
        }
        enumerator.close(null);

        try {
            directory.delete(null);
        } catch (e) {
            logError(`Failed to delete directory ${directory.get_path()}: ${e.message}`);
        }
    }

    async rescan(directory) {
        const directoryFile = Gio.File.new_for_path(directory);
        if (!directoryFile.query_exists(null)) {
            try {
                directoryFile.make_directory_with_parents(null);
                log(`Created monitored directory: ${directory}`);
            } catch (e) {
                logError(`Failed to create monitored directory ${directory}: ${e.message}`);
                return;
            }
        }

        let enumerator;
        try {
            enumerator = directoryFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            logError(`Failed to enumerate directory ${directory}: ${e.message}`);
            return;
        }

        const filesInDirectory = new Set();

        try {
            let fileInfo;
            while ((fileInfo = enumerator.next_file(null)) !== null) {
                const fileName = fileInfo.get_name();
                const filePath = GLib.build_pathv('/', [directory, fileName]);
                filesInDirectory.add(filePath);
                if (this.isAppImage(filePath)) {
                    await this.addAppImage(filePath);
                }
            }
        } finally {
            try {
                enumerator.close(null);
            } catch {
                // ignore
            }
        }

        const cachedAppImages = await this._cacheManager.getAll();
        for (const appImagePath in cachedAppImages) {
            if (!filesInDirectory.has(appImagePath)) {
                await this.removeAppImage(appImagePath);
            }
        }
    }
}
