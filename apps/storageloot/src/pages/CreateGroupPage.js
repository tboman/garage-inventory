import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { createGroup } from '../api';
import GroupForm from '../components/GroupForm';

export default function CreateGroupPage() {
  const { user, login, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (authLoading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to create a group</h2>
        <p className="text-muted">You need a Google account to create groups on StorageLoot.</p>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setSaving(true);
    setError(null);
    try {
      const id = await createGroup(data, user);
      navigate(`/group/${id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 600 }}>
      <h2 className="fw-bold mb-4">Create Group</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <GroupForm onSubmit={handleSubmit} loading={saving} submitLabel="Create Group" />
    </div>
  );
}
