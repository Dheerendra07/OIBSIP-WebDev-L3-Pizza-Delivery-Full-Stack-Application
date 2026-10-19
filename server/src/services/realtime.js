import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { isSessionVersionCurrent } from '../utils/sessionVersion.js';

const allowedOrigins = String(config.clientOrigin || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

let realtimeServer = null;

export function readSessionToken(cookieHeader) {
  const prefix = 'pizza_session=';
  const entry = String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

export function isAllowedRealtimeOrigin(origin, origins = allowedOrigins) {
  return Boolean(origin && origins.includes(origin));
}

export function buildOrderUpdatePayload(order) {
  if (!order) return null;
  const id = order._id ?? order.id;
  const user = order.user;
  const userId = user?._id ?? user;
  if (id == null || userId == null || !order.status || !order.paymentStatus) return null;

  const updatedAt = order.updatedAt ? new Date(order.updatedAt) : null;
  return {
    id: String(id),
    orderNumber: String(order.orderNumber || ''),
    status: String(order.status),
    paymentStatus: String(order.paymentStatus),
    updatedAt: updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  };
}

export function publishOrderUpdate(order, target = realtimeServer) {
  const payload = buildOrderUpdatePayload(order);
  const user = order?.user;
  const userId = user?._id ?? user;
  if (!target || !payload || userId == null) return false;

  target.to(`user:${String(userId)}`).emit('order:update', payload);
  target.to('role:admin').emit('order:update', payload);
  return true;
}

export function publishAdminRefresh(target = realtimeServer) {
  if (!target) return false;
  target.to('role:admin').emit('admin:refresh', {});
  return true;
}

export async function disconnectUserSockets(userId, target = realtimeServer) {
  if (!target || userId == null) return 0;
  const sockets = await target.in(`user:${String(userId)}`).fetchSockets();
  for (const socket of sockets) socket.disconnect(true);
  return sockets.length;
}

export async function disconnectCurrentSessionSockets(cookieHeader) {
  const token = readSessionToken(cookieHeader);
  if (!token) return 0;

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, {
      issuer: 'pizza-house-api',
      audience: 'pizza-house-client',
    });
  } catch {
    return 0;
  }
  if (!payload?.sub) return 0;

  const user = await User.findById(payload.sub).select('emailVerifiedAt sessionVersion');
  if (!user || !user.emailVerifiedAt || !isSessionVersionCurrent(payload.sv, user.sessionVersion)) return 0;
  return disconnectUserSockets(user._id);
}

export function attachRealtimeServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    allowRequest: (request, callback) => {
      if (!isAllowedRealtimeOrigin(request.headers.origin)) {
        callback(new Error('Origin not allowed'), false);
        return;
      }
      callback(null, true);
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.request.headers.cookie);
      if (!token) return next(new Error('Authentication required'));

      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, {
          issuer: 'pizza-house-api',
          audience: 'pizza-house-client',
        });
      } catch {
        return next(new Error('Authentication required'));
      }

      const user = await User.findById(payload.sub).select('name email role emailVerifiedAt sessionVersion');
      if (
        !user ||
        !user.emailVerifiedAt ||
        !isSessionVersionCurrent(payload.sv, user.sessionVersion) ||
        !['user', 'admin'].includes(user.role)
      ) {
        return next(new Error('Authentication required'));
      }

      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      return next();
    } catch {
      return next(new Error('Authentication required'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (socket.data.role === 'admin') socket.join('role:admin');
  });

  realtimeServer = io;
  return io;
}
