import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SignIn } from '../components/SignIn';
import { StatePanel } from '../components/StatePanel';

describe('SignIn', () => {
  it('submits a trimmed token without rendering it back', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);

    render(<SignIn onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/admin api token/i), '  secret-token  ');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith('secret-token');
    expect(screen.queryByDisplayValue('secret-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument();
  });
});

describe('StatePanel', () => {
  it('renders loading and retry affordances', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <StatePanel
        title="Overview unavailable"
        body="Network error"
        actionLabel="Retry"
        onAction={onAction}
      />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
