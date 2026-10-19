export function normalizeDeliveryDetails(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Add a complete delivery address before checkout.');
  }

  const text = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const deliveryDetails = {
    recipientName: text(raw.recipientName),
    phone: text(raw.phone).replace(/[\s()-]/g, ''),
    addressLine: text(raw.addressLine),
    landmark: text(raw.landmark),
    city: text(raw.city),
    state: text(raw.state),
    postalCode: text(raw.postalCode),
    instructions: text(raw.instructions),
  };

  if (deliveryDetails.recipientName.length < 2 || deliveryDetails.recipientName.length > 80) {
    throw new Error('Enter the recipient name (2–80 characters).');
  }
  if (!/^[6-9]\d{9}$/.test(deliveryDetails.phone)) {
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  }
  if (deliveryDetails.addressLine.length < 5 || deliveryDetails.addressLine.length > 180) {
    throw new Error('Enter a complete street address (5–180 characters).');
  }
  if (deliveryDetails.landmark.length > 100) {
    throw new Error('Landmark must be at most 100 characters.');
  }
  if (deliveryDetails.city.length < 2 || deliveryDetails.city.length > 80) {
    throw new Error('Enter a valid city name.');
  }
  if (deliveryDetails.state.length < 2 || deliveryDetails.state.length > 80) {
    throw new Error('Enter a valid state name.');
  }
  if (!/^[1-9]\d{5}$/.test(deliveryDetails.postalCode)) {
    throw new Error('Enter a valid 6-digit Indian PIN code.');
  }
  if (deliveryDetails.instructions.length > 200) {
    throw new Error('Delivery instructions must be at most 200 characters.');
  }

  return deliveryDetails;
}
