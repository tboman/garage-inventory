import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AgentAuthorizePage from './components/AgentAuthorizePage';
import AgentDevicePage from './components/AgentDevicePage';
import { AuthProvider } from './contexts/AuthContext';

// A personal AI agent sends people to one of these to approve access to their
// inventory: /oauth/authorize by redirect, or /device with a code to type.
// They are pages of their own, not views of the app, so they skip the app shell.
const agentPages = {
  '/oauth/authorize': AgentAuthorizePage,
  '/device': AgentDevicePage,
};
const Page = agentPages[window.location.pathname] || App;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <Page />
    </AuthProvider>
  </React.StrictMode>
);