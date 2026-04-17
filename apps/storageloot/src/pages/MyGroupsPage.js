import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMyGroups } from '../hooks/useGroups';
import GroupGrid from '../components/GroupGrid';

export default function MyGroupsPage() {
  const { user, login, loading: authLoading } = useAuth();
  const { groups, loading, error } = useMyGroups(user?.uid);

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
        <h2>Sign in to view your groups</h2>
        <button className="btn btn-sl btn-lg mt-3" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-bold mb-0">My Groups</h2>
        <Link to="/groups/create" className="btn btn-sl">+ New Group</Link>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner-border text-secondary" role="status" />
        </div>
      ) : (
        <GroupGrid groups={groups} />
      )}
    </div>
  );
}
