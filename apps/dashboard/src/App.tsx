import { useEffect, useMemo, useState } from 'react';

import { clearOperatorToken, hasOperatorToken, writeOperatorToken } from './api/auth';
import { ApiClientError, createOperatorApiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { SignIn } from './components/SignIn';
import { parseHashRoute, routeToHash, type AppRoute } from './lib/routing';
import { BookingsView } from './views/BookingsView';
import { ConversationDetailView } from './views/ConversationDetailView';
import { ConversationsView } from './views/ConversationsView';
import { HandoffsView } from './views/HandoffsView';
import { OverviewView } from './views/OverviewView';

export function App() {
  const [authed, setAuthed] = useState(() => hasOperatorToken());
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === 'undefined' ? { name: 'overview' } : parseHashRoute(window.location.hash),
  );
  const [authError, setAuthError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      createOperatorApiClient({
        onUnauthorized: () => {
          clearOperatorToken();
          setAuthed(false);
          setAuthError('Session expired or token rejected. Sign in again.');
        },
      }),
    [],
  );

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      window.location.hash = routeToHash({ name: 'overview' });
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: AppRoute) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      setRoute(next);
    }
  };

  const signOut = () => {
    clearOperatorToken();
    setAuthed(false);
    setAuthError(null);
  };

  if (!authed) {
    return (
      <SignIn
        errorMessage={authError}
        onSubmit={async (token) => {
          writeOperatorToken(token);
          setAuthError(null);
          try {
            // Validate token against a protected endpoint before entering the shell.
            const probe = createOperatorApiClient();
            await probe.getOverview();
            setAuthed(true);
          } catch (error) {
            clearOperatorToken();
            setAuthed(false);
            setAuthError(
              error instanceof ApiClientError
                ? error.message
                : 'Unable to authenticate with the operator API',
            );
          }
        }}
      />
    );
  }

  return (
    <AppShell route={route} onNavigate={navigate} onSignOut={signOut}>
      {route.name === 'overview' ? <OverviewView client={client} onNavigate={navigate} /> : null}
      {route.name === 'conversations' ? (
        <ConversationsView client={client} onNavigate={navigate} />
      ) : null}
      {route.name === 'conversation' ? (
        <ConversationDetailView
          client={client}
          conversationId={route.conversationId}
          onNavigate={navigate}
        />
      ) : null}
      {route.name === 'bookings' ? <BookingsView client={client} /> : null}
      {route.name === 'handoffs' ? <HandoffsView client={client} /> : null}
    </AppShell>
  );
}
