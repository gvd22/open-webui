import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const externalError = 'external resource relationships are not allowed';
const malformedError = 'XML is malformed';
const relationship = (attributes: string) =>
	`<Relationships><Relationship ${attributes} /></Relationships>`;
const media = 'TargetMode="External" Type="https://example.test/relationships/image"';
const cases: [string, string, string | null][] = [
	...['image', 'audio', 'video', 'media'].map((type): [string, string, string] => [
		`external ${type}`,
		relationship(
			`Target="https://attacker.invalid/media" TargetMode="External" Type="https://example.test/relationships/${type}"`
		),
		externalError
	]),
	[
		'encoded entities',
		relationship('TargetMode="Ext&#101;rnal" Type="https://example.test/relationships/im&#97;ge"'),
		externalError
	],
	['double-quoted delimiter', relationship(`Foo=">" ${media}`), externalError],
	['single-quoted delimiter', relationship(`Foo='>' ${media}`), externalError],
	[
		'namespaces and mixed case',
		'<r:Relationships xmlns:r="urn:relationships"><r:ReLaTiOnShIp tArGeTmOdE="Ext&#x65;rnal" tYpE="https://example.test/relationships/v&#x69;deo" /></r:Relationships>',
		externalError
	],
	[
		'ordinary hyperlink',
		'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Foo=">" TargetMode="External" Type="https://example.test/relationships/hyperlink" Target="https://example.test" /></Relationships>',
		null
	],
	[
		'internal media',
		relationship('TargetMode="Internal" Type="https://example.test/relationships/image"'),
		null
	],
	[
		'comment and CDATA',
		`<Relationships><!-- <Relationship ${media}/> --><![CDATA[<Relationship ${media}/>]]></Relationships>`,
		null
	],
	['processing instruction', '<?xml version="1.0"?><?office safe?><Relationships/>', null],
	[
		'comment before external media',
		`<Relationships><!-- comment --><Relationship ${media}/></Relationships>`,
		externalError
	],
	['unclosed tag', '<Relationships><Relationship', malformedError],
	['unbound namespace', '<Relationships><r:Relationship/></Relationships>', malformedError],
	[
		'duplicate attribute',
		relationship('TargetMode="Internal" TargetMode="External"'),
		malformedError
	],
	['undefined entity', relationship('TargetMode="&missing;"'), malformedError],
	[
		'ambiguous attribute case',
		relationship(`${media} targetmode="Internal"`),
		'attributes are ambiguous'
	],
	[
		'internal DTD',
		'<!DOCTYPE Relationships [<!ENTITY mode "External">]><Relationships/>',
		'DOCTYPE'
	],
	[
		'external DTD',
		'<!DOCTYPE Relationships SYSTEM "https://attacker.invalid/schema"><Relationships/>',
		'DOCTYPE'
	]
];

for (const [name, xml, expectedError] of cases) {
	test(`PPTX XML security: ${name}`, async ({ page, baseURL }) => {
		const blocked: string[] = [];
		await page.route('**/*', async (route) => {
			if (new URL(route.request().url()).origin === new URL(baseURL!).origin)
				return route.continue();
			blocked.push(route.request().url());
			await route.abort();
		});
		await page.route('**/__security', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' })
		);
		await page.goto('/__security');
		const zip = new JSZip();
		zip.file('ppt/slides/_rels/slide1.xml.rels', xml);
		const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }));
		const result = await page.evaluate(
			async ({ bytes, moduleUrl }) => {
				const { validatePptxArchive } = await import(moduleUrl);
				try {
					await validatePptxArchive(new Uint8Array(bytes).buffer);
					return null;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
			{ bytes, moduleUrl: `/@fs/${path.resolve('src/lib/components/common/documentSecurity.ts')}` }
		);
		if (expectedError) expect(result).toContain(expectedError);
		else expect(result).toBeNull();
		expect(blocked).toEqual([]);
	});
}
