import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getGroup, updateGroup } from '../api';
import GroupForm from '../components/GroupForm';

export default function EditGroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getGroup(id)
      .then(g => { if (active) setGroup(g); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (authLoading || loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container py-5 text-center">
        <h2>Group not found</h2>
        <Link to="/" className="btn btn-sl mt-3">Back to home</Link>
      </div>
    );
  }

  if (!user || user.uid !== group.ownerId) {
    return (
      <div className="container py-5 text-center">
        <h2>Not authorized</h2>
        <p className="text-muted">Only the group owner can edit this group.</p>
        <Link to={`/group/${group.id}`} className="btn btn-sl mt-3">Back to group</Link>
      </div>
    );
  }

  const handleSubmit = async (data) => {
    setSaving(true);
    setError(null);
    try {
      await updateGroup(group.id, data);
      navigate(`/group/${group.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 600 }}>
      <h2 className="fw-bold mb-4">Edit Group</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <GroupForm
        initial={{ name: group.name, type: group.type, description: group.description }}
        onSubmit={handleSubmit}
        loading={saving}
        submitLabel="Save Changes"
      />
    </div>
  );
}
