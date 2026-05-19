import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-light shadow-sm sticky-top py-3">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center" to="/">
          <span className="me-2" style={{fontSize: '1.8rem'}}>🧸</span>
          <span>Buy My Nursery</span>
        </Link>
        
        <button className="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#navContent">
          <span className="navbar-toggler-icon"></span>
        </button>

        <div className="collapse navbar-collapse" id="navContent">
          <ul className="navbar-nav me-auto mb-2 mb-lg-0 ms-lg-4">
            <li className="nav-item">
              <Link className="nav-link fw-bold" to="/">Shop All</Link>
            </li>
          </ul>
          
          <div className="d-flex align-items-center gap-3">
            {user ? (
              <>
                <Link to="/create" className="btn btn-nursery btn-sm shadow-sm">
                  Post Baby Item
                </Link>
                <div className="dropdown">
                  <button className="btn btn-link nav-link dropdown-toggle d-flex align-items-center gap-2 border-0" type="button" data-bs-toggle="dropdown">
                    <img src={user.photoURL} alt="" width="36" height="36" className="rounded-circle border border-2 border-light shadow-sm" />
                    <span className="d-none d-sm-inline fw-bold">{user.displayName}</span>
                  </button>
                  <ul className="dropdown-menu dropdown-menu-end shadow border-0 mt-2 p-2">
                    <li><Link className="dropdown-item rounded-2" to="/my-listings">My Shop</Link></li>
                    <li><hr className="dropdown-divider" /></li>
                    <li><button className="dropdown-item text-danger rounded-2" onClick={handleLogout}>Logout</button></li>
                  </ul>
                </div>
              </>
            ) : (
              <button className="btn btn-outline-primary btn-sm rounded-pill px-3" onClick={login}>
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
