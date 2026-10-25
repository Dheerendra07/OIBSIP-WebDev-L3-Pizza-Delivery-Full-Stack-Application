import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin', 'kitchen', 'delivery'], default: 'user', immutable: true },
  active: { type: Boolean, default: true, index: true },
  sessionVersion: { type: Number, min: 0, default: 0 },
  emailVerifiedAt: { type: Date, default: null },
  emailVerificationTokenHash: { type: String, select: false, default: null },
  emailVerificationExpiresAt: { type: Date, select: false, default: null },
  passwordResetTokenHash: { type: String, select: false, default: null },
  passwordResetExpiresAt: { type: Date, select: false, default: null },
}, { timestamps: true, strict: 'throw' });

userSchema.set('toJSON', { transform(_doc, ret) { delete ret.passwordHash; delete ret.emailVerificationTokenHash; delete ret.emailVerificationExpiresAt; delete ret.passwordResetTokenHash; delete ret.passwordResetExpiresAt; delete ret.__v; return ret; } });
export default mongoose.model('User', userSchema);
