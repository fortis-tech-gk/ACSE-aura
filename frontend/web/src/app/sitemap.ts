import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/results`, lastModified, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/support`, lastModified, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/login/squad`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
