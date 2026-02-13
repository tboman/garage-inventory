import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginScreen = () => {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <h1 className="mb-4">HunaPuka</h1>
      <p className="text-muted mb-4">Garage Inventory Manager</p>
      <button className="btn btn-outline-dark btn-lg" onClick={signInWithGoogle}>
        <i className="fab fa-google me-2"></i>Sign in with Google
      </button>
    </div>
  );
};

export default LoginScreen;
