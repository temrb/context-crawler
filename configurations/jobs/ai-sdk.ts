import { defineJob } from '../types.js';

export default defineJob({
	entry: 'https://ai-sdk.dev/docs/foundations/overview',
	match: [
		'https://ai-sdk.dev/docs/foundations/**',
		'https://ai-sdk.dev/docs/getting-started/**',
		'https://ai-sdk.dev/docs/agents/**',
		'https://ai-sdk.dev/docs/ai-sdk-core/**',
		'https://ai-sdk.dev/docs/ai-sdk-ui/**',
		'https://ai-sdk.dev/docs/advanced/**',
	],
	exclude: ['**/support', '**/changelog', '**/llms-full.txt*'],
	selector: 'article',
});
