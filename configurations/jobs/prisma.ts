import { defineJob } from '../types.js';

export default defineJob({
	name: 'prisma-reference',
	entry: 'https://www.prisma.io/docs/orm/reference',
	match: 'https://www.prisma.io/docs/orm/reference/**',
	selector: 'article',
});
