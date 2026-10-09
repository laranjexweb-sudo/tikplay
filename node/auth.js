const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "7d";

function hashPassword(pw) {
  return bcrypt.hashSync(String(pw), 10);
}

function verifyPassword(pw, hash) {
  try {
    return bcrypt.compareSync(String(pw), hash);
  } catch {
    return false;
  }
}

function signToken(user, opts = {}) {
  const expiresIn = (opts && opts.ttl) || TOKEN_TTL;
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function extractToken(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: "Nao autenticado" });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Token invalido ou expirado" });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Acesso restrito ao admin" });
    }
    next();
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  extractToken,
  requireAuth,
  requireAdmin,
};
