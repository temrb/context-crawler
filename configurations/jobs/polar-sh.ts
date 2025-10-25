import { defineJob } from './types';

export default defineJob({
	name: 'polar-sh-docs',
	urls: ['https://polar.sh/docs'],
	match: 'https://polar.sh/docs/**',
	selector: 'article',
});
