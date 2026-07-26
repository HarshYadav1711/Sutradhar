export type AppRoute =
  | { name: 'overview' }
  | { name: 'conversations' }
  | { name: 'conversation'; conversationId: string }
  | { name: 'bookings' }
  | { name: 'handoffs' };

export function parseHashRoute(hash: string): AppRoute {
  const raw = hash.replace(/^#/, '').replace(/^\//, '');
  const [segment, id] = raw.split('/');

  switch (segment) {
    case 'conversations':
      if (id && id.trim() !== '') {
        return { name: 'conversation', conversationId: decodeURIComponent(id) };
      }
      return { name: 'conversations' };
    case 'bookings':
      return { name: 'bookings' };
    case 'handoffs':
      return { name: 'handoffs' };
    case 'overview':
    case '':
    case undefined:
      return { name: 'overview' };
    default:
      return { name: 'overview' };
  }
}

export function routeToHash(route: AppRoute): string {
  switch (route.name) {
    case 'overview':
      return '#/overview';
    case 'conversations':
      return '#/conversations';
    case 'conversation':
      return `#/conversations/${encodeURIComponent(route.conversationId)}`;
    case 'bookings':
      return '#/bookings';
    case 'handoffs':
      return '#/handoffs';
  }
}

export function routeTitle(route: AppRoute): string {
  switch (route.name) {
    case 'overview':
      return 'Overview';
    case 'conversations':
      return 'Conversations';
    case 'conversation':
      return 'Conversation';
    case 'bookings':
      return 'Bookings';
    case 'handoffs':
      return 'Handoffs';
  }
}
