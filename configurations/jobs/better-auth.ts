import { defineJob } from '../types.js';

export default defineJob({
	name: 'better-auth-docs',
	entry: 'https://www.better-auth.com/docs/introduction',
	match: 'https://www.better-auth.com/docs/**',
	selector: 'article',
});
