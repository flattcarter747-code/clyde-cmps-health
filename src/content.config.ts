// Content collections: each health topic is one Markdown file in src/content/topics/.
// Teammates: you only need to edit the .md files. This file just checks that the
// frontmatter has everything a topic page needs (the build will tell you if something is missing).
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const icons = ['weight', 'gauge', 'candy', 'apple', 'hand-heart', 'droplet', 'brain', 'heart-pulse', 'egg'] as const;

const topics = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/topics' }),
  schema: z.object({
    title: z.string(),                 // "Blood Pressure"
    order: z.number(),                 // position on the home page grid
    icon: z.enum(icons),               // see src/components/Icon.astro
    hook: z.string(),                  // one-liner for the home page card
    description: z.string(),           // 1–2 sentences for search engines and the page intro
    quickFacts: z.array(z.string()).min(2),
    signsTitle: z.string().default('Know the signs'),     // change for topics where "signs" doesn't fit
    signs: z.array(z.string()).min(1),
    signsNote: z.string().optional(),
    actions: z.array(z.string()).min(3).max(5),   // "What you can do today"
    doctorTitle: z.string().default('When to see a doctor'),
    doctor: z.array(z.string()).min(1),           // "When to see a doctor"
    emergency: z.string().optional(),             // red "call 911" line
    bonus: z
      .object({ tag: z.string().optional(), title: z.string(), intro: z.string().optional(), items: z.array(z.string()) })
      .optional(),
    links: z
      .array(z.object({ title: z.string(), org: z.string(), url: z.url(), note: z.string().optional() }))
      .min(3)
      .max(6),
    related: z.array(z.string()).default([]),     // other topic file names, e.g. "high-cholesterol"
  }),
});

export const collections = { topics };
