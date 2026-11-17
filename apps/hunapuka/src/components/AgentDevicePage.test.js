import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AgentDevicePage from './AgentDevicePage';
import { useAuth } from '../contexts/AuthContext';
import { describeDeviceRequest, decideDeviceRequest } from '../poppyApi';

jest.mock('../firebase', () => ({ auth: {} }));
jest.mock('firebase/auth', () => ({ GoogleAuthProvider: jest.fn(), signInWithPopup: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../poppyApi', () => ({ describeDeviceRequest: jest.fn(), decideDeviceRequest: jest.fn() }));

const alice = { email: 'alice@example.com' };
const scope = (name, changes, description) => ({ name, description, hints: { changes } });
const found = (client) => ({
  found: true,
  user_code: 'WDJB-MJHT',
  client: { verified: true, name: 'Muse', domain: 'agent.example', logo_uri: null, ...client },
  scopes: [
    scope('inventory:read', 'none', 'See the items in your inventory.'),
    scope('inventory:delete', 'irreversible', 'Permanently delete items.'),
  ],
  access_days: 90,
});

const open = (search, user) => {
  window.history.pushState({}, '', `/device${search}`);
  useAuth.mockReturnValue({ user, authLoading: false, logOut: jest.fn() });
  return render(<AgentDevicePage />);
};

test('signed out, a code in the link is not even looked up', () => {
  open('?user_code=WDJB-MJHT', null);
  expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  expect(describeDeviceRequest).not.toHaveBeenCalled();
});

test('a code in the link is looked up but only Allow approves it', async () => {
  describeDeviceRequest.mockResolvedValue(found());
  decideDeviceRequest.mockResolvedValue({ found: true, approved: true });
  open('?user_code=WDJB-MJHT', alice);

  expect(await screen.findByText(/Muse wants to connect to your HunaPuka inventory/)).toBeInTheDocument();
  expect(describeDeviceRequest).toHaveBeenCalledTimes(1);
  expect(describeDeviceRequest).toHaveBeenCalledWith('WDJB-MJHT');
  // The person is asked to check the code against what their agent shows.
  expect(screen.getByText('WDJB-MJHT')).toBeInTheDocument();
  expect(screen.getByText('agent.example')).toBeInTheDocument();
  expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  expect(decideDeviceRequest).not.toHaveBeenCalled();

  // Unticking delete, then allowing, sends only what is still ticked.
  userEvent.click(screen.getByLabelText(/Permanently delete items/));
  userEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(await screen.findByText('Connected')).toBeInTheDocument();
  expect(decideDeviceRequest).toHaveBeenCalledWith('WDJB-MJHT', true, ['inventory:read']);
  expect(screen.getByText(/Go back to Muse/)).toBeInTheDocument();
});

test('a wrong code keeps the person on the form, and Cancel declines a right one', async () => {
  describeDeviceRequest.mockResolvedValueOnce({ found: false }).mockResolvedValueOnce(found());
  decideDeviceRequest.mockResolvedValue({ found: true, approved: false });
  open('', alice);

  // With no code in the link there is nothing to look up yet.
  const input = screen.getByLabelText('Code from your agent');
  expect(describeDeviceRequest).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

  userEvent.type(input, 'bbbb-bbbb');
  userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText(/not waiting for approval/)).toBeInTheDocument();

  userEvent.clear(screen.getByLabelText('Code from your agent'));
  userEvent.type(screen.getByLabelText('Code from your agent'), 'wdjb-mjht');
  userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText(/Muse wants to connect/)).toBeInTheDocument();

  userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  expect(decideDeviceRequest).toHaveBeenCalledWith('WDJB-MJHT', false, expect.any(Array));
});

test('an agent that did not prove who it is gets no name and a plain warning', async () => {
  describeDeviceRequest.mockResolvedValue(found({ verified: false, name: '', domain: '' }));
  open('?user_code=WDJB-MJHT', alice);

  expect(await screen.findByText(/An agent wants to connect/)).toBeInTheDocument();
  expect(screen.getByText(/has not proved who it is/)).toBeInTheDocument();
  expect(screen.getByText(/whoever started this request/)).toBeInTheDocument();
  expect(screen.queryByText(/This request comes from/)).not.toBeInTheDocument();
});

test('a failed lookup, such as too many wrong codes, says why', async () => {
  describeDeviceRequest.mockRejectedValue(new Error('Too many wrong codes. Wait a few minutes, then try again.'));
  open('?user_code=WDJB-MJHT', alice);
  await waitFor(() => expect(screen.getByText(/Too many wrong codes/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
});
