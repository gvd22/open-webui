import type { i18n as I18n } from 'i18next';

const german = {
	'This document is too large to display here.': 'Dieses Dokument ist zu groß für die Vorschau.',
	'This file is no longer available.': 'Diese Datei ist nicht mehr verfügbar.',
	'The document service is temporarily unavailable. Try again when it reconnects.':
		'Der Dokumentendienst ist vorübergehend nicht verfügbar. Versuche es erneut, sobald die Verbindung wiederhergestellt ist.',
	'This document could not be opened.': 'Dieses Dokument konnte nicht geöffnet werden.',
	'The latest version could not be loaded. Showing the previous version.':
		'Die neueste Version konnte nicht geladen werden. Die vorherige Version wird angezeigt.',
	'The latest update could not be displayed. Showing the previous version.':
		'Die letzte Änderung konnte nicht angezeigt werden. Die vorherige Version wird angezeigt.',
	'This file was moved. Open it again from Files.':
		'Diese Datei wurde verschoben. Öffne sie erneut unter Dateien.',
	'Document actions': 'Dokumentaktionen',
	Loading: 'Wird geladen',
	'Download displayed version': 'Angezeigte Version herunterladen',
	Fullscreen: 'Vollbild',
	'Preview not available': 'Keine Vorschau verfügbar',
	'Files are currently unavailable': 'Dateien sind derzeit nicht verfügbar',
	'This file is too large to preview. Download it instead.':
		'Diese Datei ist zu groß für die Vorschau. Lade sie stattdessen herunter.',
	'Failed to read file': 'Datei konnte nicht gelesen werden',
	'Delete failed': 'Löschen fehlgeschlagen',
	'Enter a valid name without slashes.': 'Gib einen gültigen Namen ohne Schrägstriche ein.',
	'Folder could not be created': 'Ordner konnte nicht erstellt werden',
	'File already exists': 'Datei existiert bereits',
	'File could not be created': 'Datei konnte nicht erstellt werden',
	'One or more file names are invalid.': 'Ein oder mehrere Dateinamen sind ungültig.',
	'Workspace layout could not be saved':
		'Die Anordnung im Arbeitsbereich konnte nicht gespeichert werden',
	'Open documents': 'Geöffnete Dokumente'
};

export const fileText = (i18n: I18n, message: keyof typeof german) =>
	i18n.t(message, {
		defaultValue: i18n.language?.startsWith('de') ? german[message] : message
	});
