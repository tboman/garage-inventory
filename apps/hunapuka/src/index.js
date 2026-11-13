import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AgentAuthorizePage from './components/AgentAuthorizePage';
import { AuthProvider } from './contexts/AuthContext';

// A personal AI agent sends people here to approve access to their inventory.
// It is a page of its own, not a view of the app, so it skips the app shell.
const isAgentAuthorize = window.location.pathname === '/oauth/authorize';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      {isAgentAuthorize ? <AgentAuthorizePage /> : <App />}
    </AuthProvider>
  </React.StrictMode>
);