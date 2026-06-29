import type { GlobalSearchSectionConfig } from './types'

export const GLOBAL_SEARCH_SECTIONS: GlobalSearchSectionConfig[] = [
  {
    key: 'clients',
    label: 'Klienti',
    listHref: '/clients',
    buildShowAllHref: (query) => `/clients?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'tasks',
    label: 'Úkoly',
    listHref: '/tasks',
    buildShowAllHref: (query) => `/tasks?search=${encodeURIComponent(query)}`,
  },
  {
    key: 'meetings',
    label: 'Schůzky',
    listHref: '/meetings',
    buildShowAllHref: (query) => `/meetings?search=${encodeURIComponent(query)}`,
  },
  {
    key: 'offers',
    label: 'Nabídky',
    listHref: '/offers',
    buildShowAllHref: (query) => `/offers?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'jobs',
    label: 'Zakázky',
    listHref: '/jobs',
    buildShowAllHref: (query) => `/jobs?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'jobs_portal',
    label: 'Portál zakázek',
    listHref: '/jobs-portal',
    buildShowAllHref: (query) => `/jobs-portal?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'connection_points',
    label: 'Přípojné body',
    listHref: '/pripojne-body',
    buildShowAllHref: (query) => `/pripojne-body?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'stores',
    label: 'Prodejny',
    listHref: '/prodejny',
    buildShowAllHref: (query) => `/prodejny?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'faktury',
    label: 'Faktury',
    listHref: '/faktury',
    buildShowAllHref: (query) => `/faktury?q=${encodeURIComponent(query)}`,
  },
  {
    key: 'notifications',
    label: 'Notifikace',
    listHref: '/notifications',
    buildShowAllHref: (query) => `/notifications?search=${encodeURIComponent(query)}`,
  },
]
