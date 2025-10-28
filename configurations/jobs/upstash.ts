// https://upstash.com/docs/workflow/

import { defineJob } from '../types.js';

export default defineJob([
	{
		entry: 'https://upstash.com/docs/redis/overall/getstarted',
		match: ['https://upstash.com/docs/redis/**'],
		selector: '#content-area',
		exclude: [
			'**/tutorials',
			'**/integrations',
			'**/help',
			'**/compare',
			'**/commands/**',
			'https://context7.com/**',
		],
		waitForSelectorTimeout: 15000, // Increased timeout
	},
	{
		entry: 'https://upstash.com/docs/vector/overall/getstarted',
		match: ['https://upstash.com/docs/vector/**'],
		selector: '#content-area',
		exclude: [
			'**/tutorials',
			'**/integrations',
			'**/help',
			'**/examples',
			'**/commands/**',
			'https://context7.com/**',
		],
		waitForSelectorTimeout: 15000, // Increased timeout
	},
	{
		entry: 'https://upstash.com/docs/qstash/overall/getstarted',
		match: ['https://upstash.com/docs/qstash/**'],
		selector: '#content-area',
		exclude: [
			'**/tutorials',
			'**/integrations',
			'**/help',
			'**/examples',
			'**/compare',
			'**/commands/**',
			'https://context7.com/**',
		],
		waitForSelectorTimeout: 15000, // Increased timeout
	},
	{
		entry: 'https://upstash.com/docs/workflow/getstarted',
		match: ['https://upstash.com/docs/workflow/**'],
		selector: '#content-area',
		exclude: [
			'**/tutorials',
			'**/integrations',
			'**/help',
			'**/examples',
			'**/compare',
			'**/roadmap',
			'**/commands/**',
			'https://context7.com/**',
		],
		waitForSelectorTimeout: 15000, // Increased timeout
	},
]);
