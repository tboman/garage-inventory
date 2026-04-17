import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const { user, login, logout } = useAuth();

  return (
    <nav className="navbar navbar-expand-md sl-navbar navbar-dark">
      <div className="container">
        <Link className="navbar-brand" to="/">StorageLoot</Link>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav me-auto">
            <li className="nav-item">
              <Link className="nav-link" to="/">Browse</Link>
            </li>
            {user && (
              <>
                <li className="nav-item">
                  <Link className="nav-link" to="/groups/create">New Group</Link>
                </li>
                <li className="nav-item">
                  <Link className="nav-link" to="/create">Sell an Item</Link>
                </li>
                <li className="nav-item">
                  <Link className="nav-link" to="/my-groups">My Groups</Link>
                </li>
                <li className="nav-item">
                  <Link className="nav-link" to="/my-listings">My Listings</Link>
                </li>
              </>
            )}
          </ul>
          <div className="d-flex align-items-center">
            {user ? (
              <div className="dropdown">
                <button className="btn btn-outline-light btn-sm dropdown-toggle" data-bs-toggle="dropdown">
                  {user.displayName || user.email}
                </button>
                <ul className="dropdown-menu dropdown-menu-end">
                  <li><Link className="dropdown-item" to="/my-groups">My Groups</Link></li>
                  <li><Link className="dropdown-item" to="/my-listings">My Listings</Link></li>
                  <li><hr className="dropdown-divider" /></li>
                  <li><button className="dropdown-item" onClick={logout}>Sign Out</button></li>
                </ul>
              </div>
            ) : (
              <button className="btn btn-outline-light btn-sm" onClick={login}>
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
