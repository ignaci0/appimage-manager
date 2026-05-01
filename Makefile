.PHONY: install uninstall build zip

UUID = appimage-manager@ignaci0

install: build
	gnome-extensions install --force $(UUID).zip

uninstall:
	gnome-extensions uninstall $(UUID)

build:
	glib-compile-schemas src/schemas/

zip: build
	rm -f $(UUID).zip
	cd src && zip -r ../$(UUID).zip .
	zip -ur $(UUID).zip metadata.json extension.js prefs.js README.md 

clean:
	rm -f $(UUID).zip
	rm -rf build
