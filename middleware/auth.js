'use strict';
/**
 * middleware/auth.js
 * Authentication and role-based access control middleware
 *
 * Three roles: admin | doctor | technician
 * Admin can access all routes (super-user).
 */

/**
 * Require an authenticated session.
 * Redirects to /auth/login if not logged in.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    return next();
  }
  req.flash('error', 'Please log in to access this page.');
  res.redirect('/auth/login');
}

/**
 * Require one of the specified roles.
 * Admin always passes (super-user privilege).
 *
 * Usage: requireRole('technician', 'admin')
 *        requireRole('doctor')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Authentication required.');
      return res.redirect('/auth/login');
    }
    const userRole = req.session.user.role;
    // Admin always passes
    if (userRole === 'admin') return next();
    if (allowedRoles.includes(userRole)) return next();

    req.flash('error', 'You do not have permission to access this resource.');
    res.redirect('/auth/login');
  };
}

module.exports = { requireAuth, requireRole };
