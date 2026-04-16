import React from 'react';

const ErrorAlert = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div className="alert alert-danger alert-dismissible fade show" role="alert">
      {message}
      <button type="button" className="btn-close" onClick={onDismiss} aria-label="Close"></button>
    </div>
  );
};

export default ErrorAlert;
