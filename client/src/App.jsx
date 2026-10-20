import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, ChevronDown, Clock3, CreditCard, Flame, Leaf, LoaderCircle, LogIn, LogOut, Menu, Minus, Plus, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Truck, UserRound, X, CheckCircle2, CircleUserRound, PackageCheck, ChefHat, Boxes, RefreshCw, Mail, LockKeyhole, MessageCircle } from 'lucide-react';
import { io } from 'socket.io-client';
import { api, API_ORIGIN } from './api.js';
import { orderMatchesCart, classifyExistingCheckout } from './checkout.js';
import { normalizeDeliveryDetails } from './delivery.js';
import { normalizeCatalogResponse, canCheckoutWithCatalog } from './catalog.js';
import { matchesCartSnapshot, requiresPriceConfirmation, sameServerQuote, snapshotCart, syncCartToServerQuote } from './priceReview.js';
import { buildReorderCart } from './reorder.js';
import { PENDING_PAYMENT_STORAGE_KEY, parsePendingVerification, serializePendingVerification } from './pendingPayment.js';
const DEFAULT_CATALOG = {
    bases: [{ id: 'classic', name: 'Classic Hand-Tossed', price: 0 }, { id: 'thin', name: 'Thin & Crispy', price: 30 }, { id: 'whole-wheat', name: 'Whole Wheat', price: 40 }, { id: 'pan', name: 'Pan Crust', price: 50 }, { id: 'cheese-burst', name: 'Cheese Burst', price: 70 }],
    sauces: [{ id: 'classic-tomato', name: 'Classic Tomato', price: 0 }, { id: 'spicy-arrabbiata', name: 'Spicy Arrabbiata', price: 15 }, { id: 'pesto', name: 'Basil Pesto', price: 25 }, { id: 'bbq', name: 'Smoky BBQ', price: 20 }, { id: 'white-garlic', name: 'White Garlic', price: 20 }],
    cheeses: [{ id: 'mozzarella', name: 'Mozzarella', price: 35 }, { id: 'cheddar', name: 'Cheddar Blend', price: 45 }, { id: 'vegan', name: 'Plant-Based Cheese', price: 55 }],
    vegetables: [{ id: 'capsicum', name: 'Capsicum', price: 15 }, { id: 'onion', name: 'Red Onion', price: 10 }, { id: 'mushroom', name: 'Mushrooms', price: 20 }, { id: 'olive', name: 'Black Olives', price: 20 }, { id: 'corn', name: 'Sweet Corn', price: 15 }, { id: 'jalapeno', name: 'Jalapeños', price: 15 }, { id: 'tomato', name: 'Cherry Tomato', price: 15 }],
};
const FEATURED = [
    { id: 'margherita', name: 'Margherita Classic', description: 'Basil, tomato, and stretchy mozzarella.', price: 249, tag: 'BESTSELLER', emoji: '🍅', tone: 'tomato', ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] } },
    { id: 'garden', name: 'Garden Party', description: 'A bright, crunchy mix of garden vegetables.', price: 329, tag: 'FRESH PICK', emoji: '🥦', tone: 'green', ingredients: { base: 'thin', sauce: 'pesto', cheese: 'mozzarella', vegetables: ['capsicum', 'onion', 'mushroom', 'olive'] } },
    { id: 'firecracker', name: 'Firecracker', description: 'Smoky heat, jalapeños, and a little attitude.', price: 359, tag: 'SPICY', emoji: '🌶️', tone: 'orange', ingredients: { base: 'pan', sauce: 'spicy-arrabbiata', cheese: 'cheddar', vegetables: ['jalapeno', 'onion', 'corn'] } },
    { id: 'white-garden', name: 'White Garden', description: 'Garlic, earthy mushrooms and plant-based cheese.', price: 379, tag: 'PLANT-BASED', emoji: '🌿', tone: 'cream', ingredients: { base: 'whole-wheat', sauce: 'white-garlic', cheese: 'vegan', vegetables: ['mushroom', 'capsicum', 'tomato'] } },
];
const ORDER_STEPS = [{ id: 'order_received', label: 'Order received', icon: PackageCheck }, { id: 'in_kitchen', label: 'In the kitchen', icon: ChefHat }, { id: 'sent_to_delivery', label: 'On the way', icon: Truck }, { id: 'delivered', label: 'Delivered', icon: CheckCircle2 }];
const ISSUE_CATEGORY_LABELS = { missing_item: 'Missing item', wrong_item: 'Wrong item received', quality_issue: 'Food quality concern', delivery_delay: 'Delivery delay', other: 'Something else' };
const NEW_ISSUE_FORM = { category: 'missing_item', description: '' };
const currency = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
function IconButton({ children, onClick, label, className = '', disabled = false }) { return <button type="button" aria-label={label} title={label} className={`icon-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>; }
function Toast({ toast, onClose }) { useEffect(() => { if (!toast)
    return; const id = setTimeout(onClose, 3600); return () => clearTimeout(id); }, [toast, onClose]); if (!toast)
    return null; return <div className={`toast ${toast.kind || ''}`} role="status">{toast.kind === 'error' ? <X size={17}/> : <CheckCircle2 size={17}/>}<span>{toast.message}</span><button onClick={onClose} aria-label="Dismiss message"><X size={16}/></button></div>; }
function Field({ label, icon: Icon, ...props }) { return <label className="field"><span>{label}</span><div className="field-input">{Icon && <Icon size={17}/>}<input {...props}/></div></label>; }
export default function App() {
    const [page, setPage] = useState('home');
    const [catalog, setCatalog] = useState(DEFAULT_CATALOG);
    const [featured, setFeatured] = useState(FEATURED);
    const [user, setUser] = useState(null);
    const [orders, setOrders] = useState([]);
    const [ordersStatus, setOrdersStatus] = useState('idle');
    const [ordersError, setOrdersError] = useState('');
    const ordersLoaded = useRef(false);
    const [adminStatus, setAdminStatus] = useState('idle');
    const [adminError, setAdminError] = useState('');
    const adminLoaded = useRef(false);
    const [adminData, setAdminData] = useState({ summary: null, inventory: [], orders: [], paymentReviews: [], issues: [] });
    const [issues, setIssues] = useState([]);
    const [issuesStatus, setIssuesStatus] = useState('idle');
    const [issuesError, setIssuesError] = useState('');
    const [issueReportOrder, setIssueReportOrder] = useState(null);
    const [issueForm, setIssueForm] = useState(NEW_ISSUE_FORM);
    const [pendingIssue, setPendingIssue] = useState(false);
    const [pendingAdminIssueId, setPendingAdminIssueId] = useState(null);
    const [catalogStatus, setCatalogStatus] = useState('loading');
    const [catalogError, setCatalogError] = useState('');
    const [pending, setPending] = useState(false);
    const [toast, setToast] = useState(null);
    const [authMode, setAuthMode] = useState(null);
    const [mobileMenu, setMobileMenu] = useState(false);
    const [cart, setCart] = useState([]);
    const [deliveryDetails, setDeliveryDetails] = useState({ recipientName: '', phone: '', addressLine: '', landmark: '', city: '', state: '', postalCode: '', instructions: '' });
    const [builder, setBuilder] = useState({ base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'corn'], quantity: 1 });
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [emailOnly, setEmailOnly] = useState('');
    const [resetToken, setResetToken] = useState(new URLSearchParams(location.search).get('resetToken') || '');
    const [filter, setFilter] = useState('All');
    const [activeOrderId, setActiveOrderId] = useState(null);
    const [priceReview, setPriceReview] = useState(null);
    const [pendingRefundOrderId, setPendingRefundOrderId] = useState(null);
    const [pendingVerification, setPendingVerification] = useState(() => {
        try {
            return parsePendingVerification(sessionStorage.getItem(PENDING_PAYMENT_STORAGE_KEY));
        } catch {
            return null;
        }
    });
    const notify = useCallback((message, kind = 'success') => setToast({ message, kind }), []);
    const refreshCatalog = useCallback(async () => {
        setCatalogStatus('loading');
        setCatalogError('');
        try {
            const response = normalizeCatalogResponse(await api('/catalog'));
            setCatalog(response.catalog);
            setFeatured(response.featuredPizzas);
            setCatalogStatus('ready');
            return true;
        } catch (error) {
            setCatalogStatus('error');
            setCatalogError('Prices and availability are not confirmed yet. Retry to load the current menu.');
            console.info('Live catalog unavailable:', error.message);
            return false;
        }
    }, []);
    const refreshMe = useCallback(async () => { try {
        const d = await api('/auth/me');
        setUser(d.user);
        return d.user;
    }
    catch {
        setUser(null);
        return null;
    } }, []);
    const refreshOrders = useCallback(async () => {
        if (!ordersLoaded.current) setOrdersStatus('loading');
        setOrdersError('');
        try {
            const response = await api('/orders/my');
            if (!Array.isArray(response.orders)) throw new Error('Invalid order history response');
            setOrders(response.orders);
            ordersLoaded.current = true;
            setOrdersStatus('ready');
            return true;
        } catch (error) {
            setOrdersError('We couldn’t refresh your order history. Your previous data, if any, is kept safe.');
            if (!ordersLoaded.current) setOrdersStatus('error');
            return false;
        }
    }, []);
    const refreshIssues = useCallback(async () => {
        setIssuesError('');
        if (issuesStatus === 'idle') setIssuesStatus('loading');
        try {
            const response = await api('/issues/my');
            if (!Array.isArray(response.issues)) throw new Error('Invalid customer issue response');
            setIssues(response.issues);
            setIssuesStatus('ready');
            return true;
        } catch (error) {
            setIssuesError('We couldn’t refresh your reported cases. Try again to see the latest status.');
            setIssuesStatus('error');
            return false;
        }
    }, [issuesStatus]);

    const refreshAdmin = useCallback(async () => {
        if (!adminLoaded.current) setAdminStatus('loading');
        setAdminError('');
        try {
            const [summaryResponse, inventoryResponse, orderResponse, paymentResponse, issueResponse] = await Promise.all([
                api('/admin/summary'),
                api('/admin/inventory'),
                api('/admin/orders'),
                api('/admin/payment-reviews'),
                api('/admin/issues'),
            ]);
            if (!Array.isArray(inventoryResponse.items) || !Array.isArray(orderResponse.orders) ||
                !Array.isArray(paymentResponse.events) || !Array.isArray(issueResponse.issues)) {
                throw new Error('Invalid admin dashboard response');
            }
            setAdminData({
                summary: summaryResponse.summary,
                inventory: inventoryResponse.items,
                orders: orderResponse.orders,
                paymentReviews: paymentResponse.events,
                issues: issueResponse.issues,
            });
            adminLoaded.current = true;
            setAdminStatus('ready');
            return true;
        } catch (error) {
            setAdminError('Live operations data could not be refreshed. Previous results, if any, remain visible.');
            if (!adminLoaded.current) setAdminStatus('error');
            return false;
        }
    }, []);
    useEffect(() => {
        if (!pendingVerification) return;
        setPage('cart');
        notify('A previous payment still needs confirmation. Retry the same payment; do not pay again.', 'error');
    }, [notify]);
    useEffect(() => {
        try {
            if (!pendingVerification) {
                sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
                return;
            }
            const saved = serializePendingVerification(pendingVerification);
            if (saved) sessionStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, saved);
        } catch {
            // If storage is disabled, the in-memory retry remains available for this page session.
        }
    }, [pendingVerification]);
    useEffect(() => { (async () => { await Promise.all([refreshCatalog(), refreshMe()]); })(); const params = new URLSearchParams(location.search); if (params.get('verified'))
        notify('Email verified — you can sign in now.'); if (params.get('resetToken')) {
        setAuthMode('reset');
    } if (params.get('payment') === 'failed')
        notify('Payment was not completed. Your order is still unpaid.', 'error'); }, [refreshCatalog, refreshMe, notify]);
    useEffect(() => {
        if (user?.role === 'user') {
            void refreshOrders();
            void refreshIssues();
        } else {
            setIssues([]);
            setIssuesStatus('idle');
            setIssuesError('');
        }
    }, [user, refreshOrders, refreshIssues]);
    useEffect(() => {
        if (user?.name) setDeliveryDetails(current => current.recipientName ? current : { ...current, recipientName: user.name });
    }, [user?.name]);
    useEffect(() => {
        if (user?.role === 'admin' && page === 'admin') refreshAdmin();
    }, [user, page, refreshAdmin]);
    useEffect(() => {
        if (!user) return;
        const socket = io(API_ORIGIN, { withCredentials: true });
        const synchronizeOrders = () => {
            if (user.role === 'admin') refreshAdmin();
            else refreshOrders();
        };
        socket.on('connect', synchronizeOrders);
        socket.on('order:update', synchronizeOrders);
        socket.on('admin:refresh', synchronizeOrders);
        socket.on('connect_error', (error) => {
            console.warn('Live order updates unavailable:', error.message);
        });
        return () => socket.disconnect();
    }, [user, refreshOrders, refreshAdmin]);
    const builderPrice = useMemo(() => { const find = (group, id) => catalog[group]?.find(x => x.id === id)?.price || 0; return 199 + find('bases', builder.base) + find('sauces', builder.sauce) + find('cheeses', builder.cheese) + builder.vegetables.reduce((sum, id) => sum + find('vegetables', id), 0); }, [catalog, builder]);
    const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const deliveryFee = subtotal >= 499 ? 0 : cart.length ? 29 : 0;
    const buildPriceReview = (order) => ({
        orderId: String(order.id),
        previousItems: cart.map(item => ({
            name: item.name,
            unitPrice: Number(item.unitPrice),
            quantity: Number(item.quantity),
            lineTotal: Number(item.unitPrice) * Number(item.quantity),
        })),
        previousSubtotal: subtotal,
        previousDeliveryFee: deliveryFee,
        previousTotal: subtotal + deliveryFee,
        cartSnapshot: snapshotCart(cart),
        serverOrder: order,
    });
    const navigate = (next) => { setPage(next); setMobileMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const openAuth = (mode) => { setAuthMode(mode); setForm({ name: '', email: '', password: '' }); setEmailOnly(''); };
    const submitAuth = async (e) => { e.preventDefault(); setPending(true); try {
        if (authMode === 'register') {
            await api('/auth/register', { method: 'POST', body: form });
            notify('Account created. Check your inbox; in local development without SMTP, the link appears in the API terminal.');
            setAuthMode('login');
        }
        else if (authMode === 'login' || authMode === 'admin') {
            const d = await api(authMode === 'admin' ? '/auth/admin/login' : '/auth/login', { method: 'POST', body: form });
            setUser(d.user);
            setAuthMode(null);
            setPage(d.user.role === 'admin' ? 'admin' : 'dashboard');
            notify(`Welcome${d.user.name ? `, ${d.user.name.split(' ')[0]}` : ''}!`);
        }
        else if (authMode === 'forgot') {
            await api('/auth/forgot-password', { method: 'POST', body: { email: emailOnly } });
            notify('If the account exists, reset instructions have been sent.');
            setAuthMode('login');
        }
        else if (authMode === 'reset') {
            await api(`/auth/reset-password/${encodeURIComponent(resetToken)}`, { method: 'POST', body: { password: form.password } });
            setResetToken('');
            history.replaceState({}, '', location.pathname);
            notify('Password updated. Sign in with your new password.');
            setAuthMode('login');
        }
    }
    catch (error) {
        notify(error.message, 'error');
    }
    finally {
        setPending(false);
    } };
    const signOut = async () => { if (pendingVerification) {
        notify('Confirm the previous payment before signing out so you can safely retry verification.', 'error');
        navigate('cart');
        return;
    } if (pending)
        return; try {
        await api('/auth/logout', { method: 'POST' });
    }
    catch { } setUser(null); setOrders([]); ordersLoaded.current = false; setOrdersStatus('idle'); setOrdersError(''); setAdminData({ summary: null, inventory: [], orders: [], paymentReviews: [] }); adminLoaded.current = false; setAdminStatus('idle'); setAdminError(''); setCart([]); setActiveOrderId(null); setPage('home'); notify('You have signed out.'); };
    const addFeatured = (pizza) => { const existing = cart.find(x => x.cartKey === `featured:${pizza.id}`); setCart(existing ? cart.map(x => x.cartKey === existing.cartKey ? { ...x, quantity: Math.min(10, x.quantity + 1) } : x) : [...cart, { cartKey: `featured:${pizza.id}`, type: 'featured', pizzaId: pizza.id, name: pizza.name, emoji: pizza.emoji, unitPrice: pizza.price, quantity: 1, ingredients: pizza.ingredients }]); notify(`${pizza.name} added to your bag`); };
    const addCustom = () => { const selected = [catalog.bases.find(x => x.id === builder.base), catalog.sauces.find(x => x.id === builder.sauce), catalog.cheeses.find(x => x.id === builder.cheese), ...builder.vegetables.map(id => catalog.vegetables.find(x => x.id === id))]; if (selected.some(x => x?.available === false)) {
        notify('One of those ingredients is out of stock. Update your recipe and try again.', 'error');
        return;
    } const name = `Custom ${catalog.bases.find(x => x.id === builder.base)?.name || 'Pizza'}`; const existing = { cartKey: `custom:${Date.now()}`, type: 'custom', name, emoji: '🍕', unitPrice: builderPrice, quantity: builder.quantity, base: builder.base, sauce: builder.sauce, cheese: builder.cheese, vegetables: [...builder.vegetables] }; setCart(prev => [...prev, existing]); notify('Your custom pizza is in the bag'); navigate('menu'); };
    const setQty = (key, delta) => setCart(prev => prev.map(x => x.cartKey === key ? { ...x, quantity: Math.max(1, Math.min(10, x.quantity + delta)) } : x));
    const removeCart = (key) => setCart(prev => prev.filter(x => x.cartKey !== key));
    const repeatOrder = (order) => {
        if (pendingVerification) {
            notify('Confirm the previous payment before repeating another order. Do not pay again yet.', 'error');
            navigate('cart');
            return;
        }
        if (activeOrderId) {
            notify('A checkout is still pending. Return to your bag to continue or safely resolve it before repeating an older order.', 'error');
            navigate('cart');
            return;
        }
        if (catalogStatus !== 'ready') {
            notify('The current menu and prices must load before we can rebuild this order.', 'error');
            navigate('menu');
            if (catalogStatus === 'error') void refreshCatalog();
            return;
        }
        const rebuilt = buildReorderCart(order, catalog, featured);
        if (!rebuilt.ok) {
            notify(rebuilt.message, 'error');
            navigate('menu');
            return;
        }
        if (cart.length && !window.confirm('Replace your current bag with this saved order? Your current bag will be cleared.')) return;
        setCart(rebuilt.items);
        setActiveOrderId(null);
        setPriceReview(null);
        navigate('cart');
        notify('Saved recipe restored with today’s prices. Review every item and the full total before checkout.');
    };
    const verifyCheckoutPayment = async (orderId, response) => { const attempt = { orderId, response }; try { const saved = serializePendingVerification(attempt); if (saved) sessionStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, saved); } catch { /* Continue with in-memory retry if storage is unavailable. */ } setPendingVerification(attempt); setPending(true); try {
        const verification = await api('/payments/verify', { method: 'POST', body: { orderId, ...response } });
        setPendingVerification(null);
        try { sessionStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
        setActiveOrderId(null);
        setCart([]);
        await refreshOrders();
     setPage('dashboard');
        if (verification.order?.status === 'payment_review' || verification.order?.paymentReviewRequired) notify('Payment received, but your order needs manual review. Do not pay again.', 'error');
        else notify('Payment verified! Your pizza is in the queue.');
    }
    catch (error) {
        notify(`Payment confirmation is incomplete. Do not pay again yet; retry confirmation below. ${error.message}`, 'error');
    }
    finally {
        setPending(false);
    } };
    const retryPaymentVerification = async () => { if (!pendingVerification || pending)
        return; await verifyCheckoutPayment(pendingVerification.orderId, pendingVerification.response); };

    const startCheckout = async () => {
        if (!cart.length) return;
        if (!canCheckoutWithCatalog(catalogStatus)) {
            notify('Current prices and availability are not confirmed. Refresh the menu before checkout.', 'error');
            setPage('menu');
            if (catalogStatus === 'error') void refreshCatalog();
            return;
        }
        if (!user) {
            openAuth('login');
            notify('Sign in before checkout.', 'error');
            return;
        }
        if (pendingVerification) {
            notify('Confirm the previous payment before opening checkout again.', 'error');
            return;
        }

        let normalizedDeliveryDetails;
        try {
            normalizedDeliveryDetails = normalizeDeliveryDetails(deliveryDetails);
        } catch (error) {
            notify(error.message, 'error');
            return;
        }

        setPending(true);
        try {
            let orderId = activeOrderId;
            let serverOrder = null;
            if (orderId) {
                try {
                    const existing = await api('/orders/' + orderId);
                    serverOrder = existing.order;
                    const cartMatches = orderMatchesCart(serverOrder.items, cart, featured);
                    const checkoutState = classifyExistingCheckout(serverOrder, cartMatches);
                    if (checkoutState === 'review') {
                        setActiveOrderId(null);
                        setCart([]);
                        await refreshOrders();
                        setPage('dashboard');
                        notify('Payment received, but this order needs manual review. Do not pay again.', 'error');
                        return;
                    }
                    if (checkoutState === 'already-paid') {
                        setActiveOrderId(null);
                        setCart([]);
                        await refreshOrders();
                        setPage('dashboard');
                        notify('This order is already paid and confirmed.');
                        return;
                    }
                    if (checkoutState === 'new') {
                        orderId = null;
                        serverOrder = null;
                        setActiveOrderId(null);
                    } else {
                        await api('/orders/' + orderId + '/delivery-details', {
                            method: 'PATCH',
                            body: { deliveryDetails: normalizedDeliveryDetails },
                        });
                    }
                } catch (error) {
                    if (error.status === 404) {
                        orderId = null;
                        serverOrder = null;
                        setActiveOrderId(null);
                    } else {
                        throw error;
                    }
                }
            }

            if (!orderId) {
                const created = await api('/orders', {
                    method: 'POST',
                    body: {
                        items: cart.map(item => item.type === 'featured'
                            ? { type: 'featured', pizzaId: item.pizzaId, quantity: item.quantity }
                            : {
                                type: 'custom',
                                base: item.base,
                                sauce: item.sauce,
                                cheese: item.cheese,
                                vegetables: item.vegetables,
                                quantity: item.quantity,
                            }),
                        deliveryDetails: normalizedDeliveryDetails,
                    },
                });
                serverOrder = created.order;
                orderId = serverOrder.id;
                setActiveOrderId(orderId);
            }

            if (!serverOrder) {
                serverOrder = (await api('/orders/' + orderId)).order;
            }
            if (!serverOrder || !serverOrder.id) {
                throw new Error('We could not verify the server-priced order. No payment was started; please retry.');
            }

            if (requiresPriceConfirmation({
                cart,
                order: serverOrder,
                displayedSubtotal: subtotal,
                displayedDeliveryFee: deliveryFee,
            })) {
                setPriceReview(buildPriceReview(serverOrder));
                return;
            }

            const payment = await api('/payments/create-order', { method: 'POST', body: { orderId } });
            await loadRazorpay();
            const checkout = new window.Razorpay({
                key: payment.keyId,
                amount: payment.amount,
                currency: payment.currency,
                name: 'Pizza House',
                description: 'Order ' + payment.orderNumber,
                order_id: payment.paymentOrderId,
                prefill: payment.customer,
                theme: { color: '#cf4d2c' },
                handler: (response) => { void verifyCheckoutPayment(payment.orderId, response); },
                modal: {
                    ondismiss: () => notify(
                        'Checkout closed. Your order remains unpaid; its temporary stock hold will be reconciled automatically.',
                        'error',
                    ),
                },
            });
            checkout.on('payment.failed', () => notify(
                'Payment failed. You can safely retry the same order; its stock hold will be reconciled if abandoned.',
                'error',
            ));
            checkout.open();
        } catch (error) {
            if (error.status === 409 && /reservation expired/i.test(error.message)) setActiveOrderId(null);
            notify(error.message, 'error');
        } finally {
            setPending(false);
        }
    };

    const acceptPriceReview = async () => {
        const review = priceReview;
        if (!review || pending) return;
        if (!matchesCartSnapshot(review.cartSnapshot, cart)) {
            setPriceReview(null);
            setActiveOrderId(null);
            notify('Your bag changed while the quote was open. Review the bag and start checkout again.', 'error');
            return;
        }

        setPending(true);
        try {
            const latest = (await api('/orders/' + review.orderId)).order;
            if (!sameServerQuote(review.serverOrder, latest) ||
                latest.status !== 'pending_payment' ||
                latest.paymentStatus !== 'pending') {
                setPriceReview(null);
                setActiveOrderId(null);
                notify('This quote changed or is no longer pending. Restart checkout to review the latest quote.', 'error');
                return;
            }

            const liveCatalog = normalizeCatalogResponse(await api('/catalog'));
            const synchronizedCart = syncCartToServerQuote(cart, latest, liveCatalog.catalog);
            setCatalog(liveCatalog.catalog);
            setFeatured(liveCatalog.featuredPizzas);
            setCatalogStatus('ready');
            setCatalogError('');
            setCart(synchronizedCart);
            setActiveOrderId(String(latest.id));
            setPriceReview(null);
            notify('Updated server quote accepted. Review the new total, then choose Checkout securely again.');
        } catch (error) {
            notify(error.message || 'We could not refresh the quote. No payment was started; please retry.', 'error');
        } finally {
            setPending(false);
        }
    };

    const declinePriceReview = () => {
        if (pending) return;
        setPriceReview(null);
        setActiveOrderId(null);
        notify('Quote declined. Your original bag is unchanged and no payment was started.');
    };

    const updateInventory = async (item, values) => { try {
        const d = await api(`/admin/inventory/${encodeURIComponent(item.key)}`, { method: 'PATCH', body: { stock: Number(values.stock), lowStockThreshold: Number(values.lowStockThreshold) } });
        setAdminData(prev => ({ ...prev, inventory: prev.inventory.map(x => x.key === item.key ? d.item : x) }));
        notify(`${item.name} updated`);
    }
    catch (e) {
        notify(e.message, 'error');
    } };
    const updateStatus = async (order, status) => { try {
        await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status } });
        await refreshAdmin();
        notify(`${order.orderNumber} moved to ${status.replaceAll('_', ' ')}`);
    }
    catch (e) {
        notify(e.message, 'error');
    } };
    const updateIssue = async (issue, updates) => {
        setPendingAdminIssueId(issue.id);
        try {
            const response = await api(`/admin/issues/${issue.id}`, { method: 'PATCH', body: updates });
            await refreshAdmin();
            notify(`Case ${response.issue.reference} updated.`);
        } catch (error) {
            notify(error.message || 'The case update could not be saved.', 'error');
        } finally {
            setPendingAdminIssueId(null);
        }
    };
    const submitIssueReport = async (event) => {
        event.preventDefault();
        if (!issueReportOrder || pendingIssue) return;
        const description = issueForm.description.trim();
        if (description.length < 10 || description.length > 600) {
            notify('Describe what went wrong in 10–600 characters.', 'error');
            return;
        }
        setPendingIssue(true);
        try {
            const response = await api('/issues', {
                method: 'POST',
                body: { orderId: issueReportOrder.id, category: issueForm.category, description },
            });
            setIssueReportOrder(null);
            setIssueForm(NEW_ISSUE_FORM);
            await refreshIssues();
            notify(`Case ${response.issue.reference} submitted. You can follow its status from this order.`);
        } catch (error) {
            if (error.status === 409) await refreshIssues();
            notify(error.message || 'The issue report could not be submitted.', 'error');
        } finally {
            setPendingIssue(false);
        }
    };
    const requestReviewRefund = async (event) => {
        const order = event.order;
        if (!order?.id || !event.paymentId) return;
        const hasDifferentCapturedPayment = adminData.paymentReviews.some(item =>
            item.order?.id === order.id && item.paymentId && item.paymentId !== item.order?.razorpayPaymentId
        );
        if (hasDifferentCapturedPayment || order.paymentReviewReason === 'multiple_captured_payments_for_order') {
            notify('This order has multiple captured payments. Reconcile each payment manually before refunding.', 'error');
            return;
        }
        if (event.paymentId !== order.razorpayPaymentId || order.status !== 'payment_review' ||
            !order.paymentReviewRequired || order.paymentStatus !== 'paid') {
            notify('This event cannot be safely refunded from the order action. Manual reconciliation is required.', 'error');
            return;
        }
        const retry = order.refundStatus === 'requested';
        const confirmed = window.confirm(`${retry ? 'Retry the same' : 'Issue a'} full refund for ${order.orderNumber} in Razorpay Test Mode? This action cannot be automatically undone.`);
        if (!confirmed) return;
        setPendingRefundOrderId(order.id);
        try {
            const result = await api(`/admin/orders/${order.id}/refund`, {
                method: 'POST',
                body: { paymentId: event.paymentId },
            });
            await refreshAdmin();
            if (result.refundStatus === 'processed') notify(`Full refund confirmed for ${order.orderNumber}. The order is cancelled.`);
            else if (result.refundStatus === 'pending') notify(`Refund submitted for ${order.orderNumber}; awaiting Razorpay confirmation.`);
            else if (result.refundStatus === 'failed') notify('Refund failed. Keep the order on hold and review Razorpay manually.', 'error');
            else notify('Refund status saved. Check the review queue before taking another action.');
        } catch (e) {
            await refreshAdmin();
            notify(e.message, 'error');
        } finally {
            setPendingRefundOrderId(null);
        }
    };
    const filteredPizzas = featured.filter(p => filter === 'All' || p.tag === filter);
    return <div className="app-shell">
    <div className="announcement"><span><Sparkles size={13}/> A little joy, delivered hot.</span><span className="announcement-right">Freshly made · Always worth the wait</span></div>
    <header className="site-header"><a className="brand" href="#home" onClick={e => { e.preventDefault(); navigate('home'); }}><span className="brand-mark">P<span>.</span></span><span className="brand-name">pizza<span>house</span><small>GOOD FOOD. GOOD MOOD.</small></span></a>
      <nav className={`main-nav ${mobileMenu ? 'open' : ''}`}><button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button><button className={page === 'menu' ? 'active' : ''} onClick={() => navigate('menu')}>Our menu</button><button className={page === 'builder' ? 'active' : ''} onClick={() => navigate('builder')}>Build your own</button>{user && <button className={page === 'dashboard' ? 'active' : ''} onClick={() => navigate(user.role === 'admin' ? 'admin' : 'dashboard')}>{user.role === 'admin' ? 'Admin panel' : 'My orders'}</button>}</nav>
      <div className="header-actions"><button className="bag-button" onClick={() => navigate('cart')}><ShoppingBag size={18}/><span>Bag</span><b>{cart.reduce((n, x) => n + x.quantity, 0)}</b></button>{user ? <><button className="account-button" onClick={() => navigate(user.role === 'admin' ? 'admin' : 'dashboard')}><CircleUserRound size={17}/><span>{user.name.split(' ')[0]}</span></button><IconButton className="logout-button" label="Sign out" disabled={pending || Boolean(pendingVerification)} onClick={signOut}><LogOut size={17}/></IconButton></> : <button className="sign-in" onClick={() => openAuth('login')}>Sign in <ArrowUpRight size={16}/></button>}<IconButton className="mobile-toggle" label="Open menu" onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X size={20}/> : <Menu size={20}/>}</IconButton></div>
    </header>

    <main>
    {page === 'home' && <><section className="hero section-wrap"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot"/> NOT YOUR AVERAGE PIZZA NIGHT</div><h1>Happiness is<br />a <em>perfect slice.</em></h1><p className="hero-description">Thoughtfully made dough. Ingredients that shine. And that first bite you’ll think about tomorrow.</p><div className="hero-actions"><button className="button button-dark" onClick={() => navigate('menu')}>Explore the menu <ArrowRight size={17}/></button><button className="text-link" onClick={() => navigate('builder')}>Make it yours <ArrowUpRight size={16}/></button></div><div className="hero-proof"><div className="avatar-stack"><span>🍅</span><span>🧀</span><span>🌿</span></div><div><div className="stars">✳ <span>Made for your cravings</span></div><small>Choose your ingredients, make it yours</small></div><div className="proof-divider"/><div><strong>5<span>+</span></strong><small>base & sauce choices</small></div></div></div><div className="hero-art"><div className="hero-halo"/><div className="hero-ring ring-one"/><div className="hero-ring ring-two"/><div className="hero-pizza"><span className="pizza-emoji">🍕</span><div className="pizza-stamp">MADE FRESH<br />JUST FOR YOU</div></div><div className="floating-note note-top"><span>✳</span><div><strong>Fresh daily</strong><small>Never frozen dough</small></div></div><div className="floating-note note-bottom"><span className="note-leaf">♧</span><div><strong>Your kind of pizza</strong><small>Built exactly your way</small></div></div><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span></div></section>
      <section className="promise-strip"><div><span className="promise-icon"><Leaf size={20}/></span><div><b>Good ingredients</b><small>Nothing to hide</small></div></div><div><span className="promise-icon"><Flame size={20}/></span><div><b>Hot from our oven</b><small>Made when you order</small></div></div><div><span className="promise-icon"><Truck size={20}/></span><div><b>At your door</b><small>With love, not late</small></div></div><div><span className="promise-icon"><BadgeCheck size={20}/></span><div><b>Easy & secure</b><small>Checkout you can trust</small></div></div></section>
      <section className="section-wrap menu-preview"><div className="section-heading"><div><div className="eyebrow">THE CROWD PLEASERS</div><h2>Love at first <em>bite.</em></h2><p>The ones everyone talks about on the way home.</p></div><button className="text-link" onClick={() => navigate('menu')}>The full menu <ArrowRight size={16}/></button></div>{catalogStatus === 'loading' ? <PizzaGridSkeleton count={3}/> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : featured.length ? <div className="pizza-grid">{featured.slice(0, 3).map((pizza, i) => <PizzaCard key={pizza.id} pizza={pizza} index={i} onAdd={() => addFeatured(pizza)} onCustomize={() => navigate('builder')}/>)}</div> : <CatalogEmpty onRetry={refreshCatalog} />}<div className="custom-callout"><div className="callout-icon">✳</div><div><span>THE CHEF IS YOU</span><h3>Have it your way.</h3><p>Choose your crust, sauce, cheese and all the good stuff.</p></div><button className="button button-light" onClick={() => navigate('builder')}>Build my pizza <ArrowRight size={17}/></button><div className="callout-watermark">🍕</div></div></section>
      <section className="last-word"><span className="last-word-mark">“</span><p>There’s no such thing as<br />a bad day with <em>good pizza.</em></p><span className="last-word-caption">A LITTLE HOUSE WISDOM</span></section></>}

    {page === 'menu' && <section className="section-wrap page-section"><div className="page-intro"><div className="eyebrow">PICK YOUR HAPPY</div><h1>Every slice has<br /><em>a story.</em></h1><p>Choose a classic or get creative. Your cravings, your rules.</p></div>{catalogStatus === 'loading' ? <PizzaGridSkeleton count={6} full /> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : <><div className="filter-row"><div className="filter-label"><SlidersHorizontal size={16}/> Find your flavour</div>{['All', 'BESTSELLER', 'FRESH PICK', 'SPICY', 'PLANT-BASED'].map(f => <button className={`filter-chip ${filter === f ? 'selected' : ''}`} key={f} onClick={() => setFilter(f)}>{f === 'All' ? 'Everything' : f}</button>)}</div>{filteredPizzas.length ? <div className="pizza-grid full-grid">{filteredPizzas.map((pizza, i) => <PizzaCard key={pizza.id} pizza={pizza} index={i} onAdd={() => addFeatured(pizza)} onCustomize={() => navigate('builder')}/>)}</div> : <CatalogEmpty onRetry={filter === 'All' ? refreshCatalog : () => setFilter('All')} emptyFilter={filter !== 'All'}/>}<div className="menu-bottom"><span>Can’t find your perfect slice?</span><button className="text-link" onClick={() => navigate('builder')}>Dream one up <ArrowRight size={16}/></button></div></>}</section>}

    {page === 'builder' && <section className="section-wrap page-section"><div className="page-intro compact"><div className="eyebrow">YOUR PIZZA. YOUR RULES.</div><h1>The art of <em>your slice.</em></h1><p>Four little choices. One very personal pizza.</p></div>{catalogStatus === 'loading' ? <BuilderSkeleton/> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : <div className="builder-layout"><div className="builder-steps"><BuilderGroup step="01" title="Start with the base" subtitle="The foundation of every good thing" options={catalog.bases} value={builder.base} onChange={v => setBuilder(p => ({ ...p, base: v }))}/><BuilderGroup step="02" title="Pick your sauce" subtitle="Set the mood" options={catalog.sauces} value={builder.sauce} onChange={v => setBuilder(p => ({ ...p, sauce: v }))}/><BuilderGroup step="03" title="Make it cheesy" subtitle="The good stuff" options={catalog.cheeses} value={builder.cheese} onChange={v => setBuilder(p => ({ ...p, cheese: v }))}/><div className="builder-group"><div className="builder-step"><span>04</span><div><h3>Top it your way</h3><p>Pick up to five. Go wild.</p></div><b>{builder.vegetables.length}/5</b></div><div className="veg-grid">{catalog.vegetables.map(v => <button key={v.id} disabled={v.available === false && !builder.vegetables.includes(v.id)} aria-pressed={builder.vegetables.includes(v.id)} className={`veg-option ${builder.vegetables.includes(v.id) ? 'chosen' : ''}`} onClick={() => setBuilder(p => ({ ...p, vegetables: p.vegetables.includes(v.id) ? p.vegetables.filter(x => x !== v.id) : p.vegetables.length < 5 ? [...p.vegetables, v.id] : p.vegetables }))}><span className="veg-check">{builder.vegetables.includes(v.id) ? '✓' : '+'}</span><span>{v.name}</span><small>+{currency(v.price)}</small></button>)}</div></div></div><aside className="builder-summary"><div className="summary-picture">🍕<span className="summary-badge">YOUR CREATION</span></div><div className="summary-body"><div className="eyebrow">LOOKS LIKE LOVE</div><h2>Your masterpiece.</h2><p className="summary-subtitle">Made just the way you like it.</p><div className="summary-ingredients"><Ingredient label="Base" value={catalog.bases.find(x => x.id === builder.base)?.name}/><Ingredient label="Sauce" value={catalog.sauces.find(x => x.id === builder.sauce)?.name}/><Ingredient label="Cheese" value={catalog.cheeses.find(x => x.id === builder.cheese)?.name}/><Ingredient label="Toppings" value={builder.vegetables.map(id => catalog.vegetables.find(x => x.id === id)?.name).filter(Boolean).join(', ') || 'No extras'}/></div><div className="summary-qty"><span>Quantity</span><div className="quantity-stepper"><IconButton label="Decrease quantity" onClick={() => setBuilder(p => ({ ...p, quantity: Math.max(1, p.quantity - 1) }))}><Minus size={14}/></IconButton><b>{builder.quantity}</b><IconButton label="Increase quantity" onClick={() => setBuilder(p => ({ ...p, quantity: Math.min(10, p.quantity + 1) }))}><Plus size={14}/></IconButton></div></div><div className="summary-total"><span>Your pizza</span><strong>{currency(builderPrice * builder.quantity)}</strong></div><button className="button button-dark full-button" onClick={addCustom}>Add to my bag <ArrowRight size={17}/></button><small className="summary-footnote"><ShieldCheck size={14}/> Freshly made. Secure checkout.</small></div></aside></div>}</section>}

    {page === 'cart' && <section className="section-wrap page-section"><div className="eyebrow">THE GOOD STUFF</div><h1>Your little <em>bag of joy.</em></h1>{catalogStatus === 'loading' && <div className="catalog-checkout-notice" role="status"><LoaderCircle size={16} className="spin"/><span>Confirming current prices and availability before checkout…</span></div>}{catalogStatus === 'error' && <CatalogUnavailable onRetry={refreshCatalog} message={catalogError} />}{pendingVerification && <PaymentRetryPanel pending={pending} onRetry={retryPaymentVerification}/>}{!cart.length ? <div className="empty-state"><div className="empty-art">🍕</div><h2>It’s a little empty in here.</h2><p>Your next favourite is only a slice away.</p><button className="button button-dark" onClick={() => navigate('menu')}>Find my pizza <ArrowRight size={17}/></button></div> : <div className="cart-layout"><div className="cart-lines">{cart.map(item => <div className="cart-line" key={item.cartKey}><div className="cart-line-art">{item.emoji}</div><div className="cart-line-info"><span className="eyebrow">{item.type === 'custom' ? 'MADE BY YOU' : 'PIZZA HOUSE CLASSIC'}</span><h3>{item.name}</h3><p>{item.type === 'featured' ? 'House recipe, made fresh' : `${catalog.bases.find(x => x.id === item.base)?.name || ''} · ${catalog.sauces.find(x => x.id === item.sauce)?.name || ''}`}</p><div className="quantity-stepper"><IconButton label="Decrease quantity" onClick={() => setQty(item.cartKey, -1)}><Minus size={14}/></IconButton><b>{item.quantity}</b><IconButton label="Increase quantity" onClick={() => setQty(item.cartKey, 1)}><Plus size={14}/></IconButton></div></div><div className="cart-line-price"><b>{currency(item.unitPrice * item.quantity)}</b><button onClick={() => removeCart(item.cartKey)}>Remove</button></div></div>)}<button className="text-link" onClick={() => navigate('menu')}>+ Add another pizza</button>
    <section className="delivery-details-panel" aria-labelledby="delivery-details-title">
      <div className="delivery-details-heading"><div className="eyebrow">DELIVERY DETAILS</div><h2 id="delivery-details-title">Where should we send your pizza?</h2><p>We’ll attach these details to your order so the team knows where it’s going.</p></div>
      <div className="delivery-details-grid">
        <Field label="Recipient name" autoComplete="name" maxLength={80} required placeholder="Full name" value={deliveryDetails.recipientName} onChange={e => setDeliveryDetails(p => ({ ...p, recipientName: e.target.value }))}/>
        <Field label="10-digit mobile number" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} required placeholder="9876543210" value={deliveryDetails.phone} onChange={e => setDeliveryDetails(p => ({ ...p, phone: e.target.value }))}/>
        <Field label="House / street address" autoComplete="street-address" maxLength={180} required placeholder="House no., street, area" value={deliveryDetails.addressLine} onChange={e => setDeliveryDetails(p => ({ ...p, addressLine: e.target.value }))}/>
        <Field label="Landmark (optional)" maxLength={100} placeholder="Nearby landmark" value={deliveryDetails.landmark} onChange={e => setDeliveryDetails(p => ({ ...p, landmark: e.target.value }))}/>
        <Field label="City" autoComplete="address-level2" maxLength={80} required placeholder="City" value={deliveryDetails.city} onChange={e => setDeliveryDetails(p => ({ ...p, city: e.target.value }))}/>
        <Field label="State" autoComplete="address-level1" maxLength={80} required placeholder="State" value={deliveryDetails.state} onChange={e => setDeliveryDetails(p => ({ ...p, state: e.target.value }))}/>
        <Field label="6-digit PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} required placeholder="250001" value={deliveryDetails.postalCode} onChange={e => setDeliveryDetails(p => ({ ...p, postalCode: e.target.value }))}/>
      </div>
      <label className="delivery-instructions"><span>Delivery instructions (optional)</span><textarea rows={2} maxLength={200} placeholder="Gate, floor, or call-on-arrival notes" value={deliveryDetails.instructions} onChange={e => setDeliveryDetails(p => ({ ...p, instructions: e.target.value }))}/></label>
    </section></div><aside className="order-summary"><h2>Little details.</h2><div className="price-row"><span>Subtotal</span><b>{currency(subtotal)}</b></div><div className="price-row"><span>Delivery</span><b>{deliveryFee === 0 ? 'On us!' : currency(deliveryFee)}</b></div><div className="free-delivery-hint">{subtotal >= 499 ? 'Lovely — delivery is on us!' : `Add ${currency(499 - subtotal)} for free delivery.`}</div><div className="summary-divider"/><div className="price-row final"><span>Total</span><b>{currency(subtotal + deliveryFee)}</b></div><button disabled={pending || Boolean(pendingVerification) || !canCheckoutWithCatalog(catalogStatus)} className="button button-dark full-button" onClick={startCheckout}>{pending ? <LoaderCircle className="spin" size={17}/> : catalogStatus === 'ready' ? <CreditCard size={17}/> : <RefreshCw size={17}/>} {pending ? 'Getting checkout ready' : pendingVerification ? 'Confirm previous payment first' : catalogStatus === 'loading' ? 'Confirming live prices…' : catalogStatus === 'error' ? 'Refresh menu before checkout' : 'Checkout securely'}</button><small className="summary-footnote"><ShieldCheck size={14}/> Payments secured by Razorpay</small><p className="terms-note">Test mode only. You won’t be charged real money while test credentials are active.</p></aside></div>}</section>}

    {page === 'dashboard' && <section className="section-wrap page-section"><div className="dashboard-top"><div><div className="eyebrow">YOUR PIZZA DIARY</div><h1>Good to see you, <em>{user?.name?.split(' ')[0] || 'friend'}.</em></h1><p>Every great day deserves a great slice.</p></div><button className="button button-light" onClick={() => navigate('menu')}>Order something lovely <ArrowRight size={16}/></button></div>{(ordersStatus === 'loading' || ordersStatus === 'idle') ? <DashboardMetricSkeleton/> : <div className="dashboard-metrics"><div><span>ORDERS MADE</span><strong>{ordersStatus === 'ready' ? orders.length.toString().padStart(2, '0') : '—'}</strong><small>{ordersStatus === 'ready' ? 'And counting' : 'Not available'}</small></div><div><span>ON THE WAY</span><strong>{ordersStatus === 'ready' ? orders.filter(o => ['order_received', 'in_kitchen', 'sent_to_delivery'].includes(o.status)).length.toString().padStart(2, '0') : '—'}</strong><small>{ordersStatus === 'ready' ? 'Good things incoming' : 'Not available'}</small></div><div><span>YOUR LAST ORDER</span><strong>{ordersStatus === 'ready' && orders[0] ? currency(orders[0].total) : '—'}</strong><small>{ordersStatus === 'ready' ? orders[0]?.orderNumber || 'Your first slice awaits' : 'Not available'}</small></div></div>}<div className="section-heading dashboard-heading"><div><h2>Order <em>updates.</em></h2><p>We’ll keep you in the loop. This list refreshes automatically.</p></div><button className="text-link" onClick={refreshOrders}><RefreshCw size={15}/> Refresh</button></div>{ordersError && ordersStatus === 'ready' && <InlineDataWarning message={ordersError} onRetry={refreshOrders} />}{(ordersStatus === 'loading' || ordersStatus === 'idle') ? <OrderListSkeleton count={2}/> : ordersStatus === 'error' ? <DataUnavailable title="Your orders haven’t loaded" message="We couldn’t confirm your order history. Please retry instead of assuming there are no orders." onRetry={refreshOrders}/> : orders.length ? <div className="orders-list">{orders.map(order => <OrderCard key={order.id} order={order} onReorder={repeatOrder} issue={issues.find(item => item.orderId === order.id)} onReportIssue={setIssueReportOrder} onRefreshIssues={refreshIssues}/>)}</div> : <div className="empty-state compact-empty"><div className="empty-art">🥡</div><h2>The first one’s always special.</h2><p>Place an order and watch the magic happen here.</p><button className="button button-dark" onClick={() => navigate('menu')}>Explore the menu <ArrowRight size={17}/></button></div>}</section>}

    {page === 'admin' && <section className="section-wrap page-section admin-page"><div className="admin-heading"><div><div className="eyebrow">BEHIND THE COUNTER</div><h1>Good food takes <em>good care.</em></h1><p>Live order events refresh the queue. Use Refresh data to recheck inventory and payment status.</p></div><button className="button button-light" onClick={refreshAdmin}><RefreshCw size={16}/> Refresh data</button></div>{!user || user.role !== 'admin' ? <div className="empty-state"><div className="empty-art">🔐</div><h2>Admin access only.</h2><p>Sign in through the separate admin sign-in flow.</p><button className="button button-dark" onClick={() => openAuth('admin')}>Admin sign in <ArrowRight size={16}/></button></div> : (adminStatus === 'loading' || adminStatus === 'idle') ? <AdminPanelsSkeleton/> : adminStatus === 'error' ? <DataUnavailable title="Operations data isn’t available" message="Inventory, order and payment-review data could not be confirmed. Retry to load the live dashboard." onRetry={refreshAdmin}/> : <>{adminError && <InlineDataWarning message={adminError} onRetry={refreshAdmin}/>}<div className="admin-metrics">{[{ label: 'Total orders', value: adminData.summary?.ordersTotal ?? '—', icon: ShoppingBag }, { label: 'Paid orders', value: adminData.summary?.paidOrders ?? '—', icon: BadgeCheck }, { label: 'Revenue', value: currency(adminData.summary?.revenue), icon: ArrowUpRight }, { label: 'Low-stock items', value: adminData.summary?.lowStock ?? '—', icon: Boxes }].map(item => <div className="admin-metric" key={item.label}><span><item.icon size={17}/>{item.label}</span><strong>{item.value}</strong></div>)}</div><div className="admin-panel"><div className="panel-heading"><div><h2>Inventory room</h2><p>Update stock counts and per-item alert thresholds.</p></div><Boxes size={20}/></div><div className="inventory-table"><div className="inventory-row inventory-header"><span>Item</span><span>In stock</span><span>Alert at</span><span>State</span></div>{adminData.inventory.length ? adminData.inventory.map(item => <InventoryRow key={item.key} item={item} onSave={updateInventory}/>) : <div className="empty-small">No inventory items were returned by the API.</div>}</div></div><div className="admin-panel"><div className="panel-heading"><div><h2>Payment review queue</h2><p>Signed webhook events needing manual reconciliation.</p></div><ShieldCheck size={20}/></div>{adminData.paymentReviews.length ? <div className="payment-review-list">{adminData.paymentReviews.map(event => <article className="payment-review-event" key={event.eventId}><div><strong>{event.eventType}</strong><small>{event.order?.orderNumber || 'Unmatched provider order'} · {new Date(event.receivedAt).toLocaleString()}</small></div><p>{event.reason?.replaceAll('_', ' ') || 'Manual review required'}</p><small>Provider order: {event.providerOrderId || 'not supplied'} · Payment: {event.paymentId || 'not supplied'}</small><small>Event ID: {event.eventId}</small>{event.order?.refundStatus === 'pending' && <p className="refund-status-note">Refund pending with Razorpay. Do not submit another refund.</p>}{event.order?.refundStatus === 'failed' && <p className="refund-status-note">Refund failed or was rejected. Manual provider review is required.</p>}{event.order?.id && event.order.status === 'payment_review' && event.order.paymentReviewRequired && event.order.paymentStatus === 'paid' && event.paymentId === event.order.razorpayPaymentId && event.reason !== 'multiple_captured_payments_for_order' && !adminData.paymentReviews.some(item => item.order?.id === event.order.id && item.paymentId && item.paymentId !== item.order?.razorpayPaymentId) && !['pending', 'processed', 'failed'].includes(event.order.refundStatus || 'none') && <div className="payment-review-actions"><small>{event.order.refundStatus === 'requested' ? 'A retry reuses the same provider idempotency key.' : 'Use only after reviewing the captured-payment exception.'}</small><button type="button" className="button button-light small-button" disabled={pendingRefundOrderId === event.order.id} onClick={() => requestReviewRefund(event)}>{pendingRefundOrderId === event.order.id ? 'Submitting…' : event.order.refundStatus === 'requested' ? 'Retry safely' : 'Issue full refund'}</button></div>}</article>)}</div> : <div className="empty-small">No payment webhook reviews are currently queued.</div>}</div><div className="admin-panel"><div className="panel-heading"><div><h2>Incoming orders</h2><p>Move paid orders through the kitchen and delivery.</p></div><ShoppingBag size={20}/></div>{adminData.orders.length ? <div className="orders-list">{adminData.orders.map(order => <OrderCard key={order.id} order={order} admin onStatus={updateStatus}/>)}</div> : <div className="empty-small">No orders have come in yet.</div>}</div></>}</section>}
    </main>
    <footer className="site-footer"><div className="footer-main"><a className="brand footer-brand" href="#home" onClick={e => { e.preventDefault(); navigate('home'); }}><span className="brand-mark">P<span>.</span></span><span className="brand-name">pizza<span>house</span><small>GOOD FOOD. GOOD MOOD.</small></span></a><p>Made for the good days.<br />And the days that need a little help.</p><button className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to the top <ArrowUpRight size={16}/></button></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Pizza House. Made with a little extra cheese.</span><div><span>Fresh food, honest ingredients</span><span className="footer-dot">·</span><span>Secure payments</span></div></div></footer>
    <Toast toast={toast} onClose={() => setToast(null)}/>
    {priceReview && <PriceReviewDialog review={priceReview} catalog={catalog} pending={pending} onAccept={acceptPriceReview} onCancel={declinePriceReview}/>}
    {issueReportOrder && <IssueReportDialog order={issueReportOrder} form={issueForm} setForm={setIssueForm} pending={pendingIssue} onSubmit={submitIssueReport} onCancel={() => { if (!pendingIssue) { setIssueReportOrder(null); setIssueForm(NEW_ISSUE_FORM); } }}/>}
    {authMode && <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && setAuthMode(null)}><div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><IconButton className="modal-close" label="Close dialog" onClick={() => setAuthMode(null)}><X size={19}/></IconButton><div className="auth-brand-mark">P<span>.</span></div><div className="eyebrow">{authMode === 'admin' ? 'TEAM ACCESS' : 'COME ON IN'}</div><h2 id="auth-title">{authMode === 'register' ? 'Make yourself at home.' : authMode === 'forgot' ? 'A fresh start.' : authMode === 'reset' ? 'New password, new slice.' : authMode === 'admin' ? 'Welcome back, team.' : 'Your table is waiting.'}</h2><p>{authMode === 'register' ? 'Create an account to follow every lovely order.' : authMode === 'forgot' ? 'We’ll send a secure reset link if your account exists.' : authMode === 'reset' ? 'Choose a strong new password to get back in.' : authMode === 'admin' ? 'Sign in with your separately provisioned admin account.' : 'Sign in for order updates and a little more pizza joy.'}</p><form onSubmit={submitAuth}>{authMode === 'register' && <Field label="Your name" icon={UserRound} placeholder="How should we call you?" autoComplete="name" required minLength={2} maxLength={80} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}/>}{authMode === 'forgot' && <Field label="Email address" icon={Mail} type="email" placeholder="you@example.com" required autoComplete="email" value={emailOnly} onChange={e => setEmailOnly(e.target.value)}/>}{!['forgot'].includes(authMode) && authMode !== 'reset' && <Field label="Email address" icon={Mail} type="email" placeholder="you@example.com" required autoComplete="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}/>}{(authMode === 'login' || authMode === 'register' || authMode === 'admin' || authMode === 'reset') && <Field label={authMode === 'reset' ? 'New password' : 'Password'} icon={LockKeyhole} type="password" placeholder={authMode === 'reset' ? '10+ characters, mixed case and a number' : 'At least 10 characters'} required minLength={10} autoComplete={authMode === 'login' || authMode === 'admin' ? 'current-password' : 'new-password'} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}/>}{authMode === 'login' && <button type="button" className="forgot-link" onClick={() => setAuthMode('forgot')}>Forgot password?</button>}<button disabled={pending} className="button button-dark full-button auth-submit">{pending ? <LoaderCircle size={17} className="spin"/> : authMode === 'reset' ? <LockKeyhole size={17}/> : authMode === 'forgot' ? <Mail size={17}/> : authMode === 'admin' ? <ShieldCheck size={17}/> : authMode === 'register' ? <UserRound size={17}/> : <LogIn size={17}/>} {pending ? 'Please wait…' : authMode === 'register' ? 'Create my account' : authMode === 'forgot' ? 'Send reset link' : authMode === 'reset' ? 'Update password' : authMode === 'admin' ? 'Sign in as admin' : 'Sign in'}</button></form>{authMode === 'login' ? <div className="auth-switch">New around here? <button onClick={() => setAuthMode('register')}>Create an account</button><button className="admin-link" onClick={() => setAuthMode('admin')}>Team sign in</button></div> : authMode === 'register' ? <div className="auth-switch">Already part of the house? <button onClick={() => setAuthMode('login')}>Sign in</button></div> : authMode === 'admin' ? <div className="auth-switch">Customer account? <button onClick={() => setAuthMode('login')}>Customer sign in</button></div> : <div className="auth-switch"><button onClick={() => setAuthMode('login')}>Back to sign in</button></div>}<small className="auth-privacy"><ShieldCheck size={13}/> Your details stay protected. We never store card numbers.</small></div></div>}
  </div>;
}
function PizzaCard({ pizza, index, onAdd, onCustomize }) { return <article className={`pizza-card ${pizza.tone} card-${index}`}><div className="pizza-card-art"><span className="pizza-label">{pizza.tag}</span><span className="pizza-card-emoji">{pizza.emoji}</span><span className="pizza-card-number">0{index + 1}</span></div><div className="pizza-card-body"><div><h3>{pizza.name}</h3><p>{pizza.description}</p></div><div className="pizza-card-bottom"><strong>{currency(pizza.price)}</strong><button className="add-button" onClick={onAdd} disabled={pizza.available === false} aria-label={pizza.available === false ? `${pizza.name} sold out` : `Add ${pizza.name}`}><Plus size={17}/><span>{pizza.available === false ? 'Sold out' : 'Add'}</span></button></div><button className="customize-link" onClick={onCustomize}>Make something similar <ArrowUpRight size={14}/></button></div></article>; }
function DataUnavailable({ title, message, onRetry }) { return <div className="catalog-state-card data-unavailable" role="alert"><span className="catalog-state-icon"><RefreshCw size={20}/></span><div className="catalog-state-copy"><h3>{title}</h3><p>{message}</p></div><button className="button button-dark" type="button" onClick={onRetry}>Try again <RefreshCw size={15}/></button></div>; }
function InlineDataWarning({ message, onRetry }) { return <div className="inline-data-warning" role="status"><span>{message}</span><button type="button" onClick={onRetry}>Retry <RefreshCw size={14}/></button></div>; }
function DashboardMetricSkeleton() { return <div className="dashboard-metrics dashboard-metrics-loading" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading order summary…</span>{Array.from({ length: 3 }, (_, i) => <div className="dashboard-metric-placeholder" key={i}><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-metric-number"/><span className="skeleton-line skeleton-meta short"/></div>)}</div>; }
function OrderCardSkeleton({ showAction = false }) { return <article className="order-card order-card-skeleton" aria-hidden="true"><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-order-title"/><span className="skeleton-line skeleton-description"/><div className="skeleton-order-bottom"><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-status"/></div>{showAction && <div className="order-repeat-actions order-repeat-skeleton"><span className="skeleton-line skeleton-repeat-copy"/><span className="skeleton-line skeleton-repeat-action"/></div>}</article>; }
function OrderListSkeleton({ count = 2 }) { return <div className="orders-list" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading orders…</span>{Array.from({ length: count }, (_, i) => <OrderCardSkeleton key={i} showAction/>)}</div>; }
function AdminPanelsSkeleton() { return <div className="admin-panels-loading" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading live operations…</span><DashboardAdminMetricSkeleton /><div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/><div className="admin-row-skeletons">{Array.from({ length: 5 }, (_, i) => <div className="inventory-row-skeleton" key={i}><span className="skeleton-line"/><span className="skeleton-line"/><span className="skeleton-line"/><span className="skeleton-line"/></div>)}</div></div><div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/>{Array.from({ length: 2 }, (_, i) => <OrderCardSkeleton key={i}/>)}</div><div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/><div className="orders-list">{Array.from({ length: 2 }, (_, i) => <OrderCardSkeleton key={i}/>)}</div></div></div>; }
function DashboardAdminMetricSkeleton() { return <div className="admin-metrics dashboard-metrics-loading">{Array.from({ length: 4 }, (_, i) => <div className="dashboard-metric-placeholder" key={i}><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-metric-number"/><span className="skeleton-line skeleton-meta short"/></div>)}</div>; }
function PizzaCardSkeleton() { return <article className="pizza-card pizza-card-skeleton" aria-hidden="true"><div className="skeleton-art"/><div className="pizza-card-body skeleton-card-body"><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><span className="skeleton-line skeleton-description short"/><div className="skeleton-card-bottom"><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-action"/></div><span className="skeleton-line skeleton-link"/></div></article>; }
function PizzaGridSkeleton({ count = 3, full = false }) { return <div className={`pizza-grid ${full ? 'full-grid' : ''}`} role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading pizza choices…</span>{Array.from({ length: count }, (_, i) => <PizzaCardSkeleton key={i}/>)}</div>; }
function CatalogUnavailable({ onRetry, message }) { return <div className="catalog-state-card" role="alert"><span className="catalog-state-icon"><RefreshCw size={20}/></span><div className="catalog-state-copy"><h3>We can’t confirm the live menu right now.</h3><p>{message || 'Prices and availability are not confirmed yet. Please retry before choosing.'}</p></div><button className="button button-dark" type="button" onClick={onRetry}>Try again <RefreshCw size={15}/></button></div>; }
function CatalogEmpty({ onRetry, emptyFilter = false }) { return <div className="catalog-state-card catalog-empty-state" role="status"><span className="catalog-state-icon"><ShoppingBag size={20}/></span><div className="catalog-state-copy"><h3>{emptyFilter ? 'No pizzas match this filter.' : 'No pizzas are available right now.'}</h3><p>{emptyFilter ? 'Choose another flavour filter to see more options.' : 'The current menu did not return any pizzas. Check again shortly.'}</p></div><button className="button button-light" type="button" onClick={onRetry}>{emptyFilter ? 'Clear filter' : 'Refresh menu'} <RefreshCw size={15}/></button></div>; }
function BuilderSkeleton() { return <div className="builder-layout builder-loading" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading pizza ingredients…</span><div className="builder-loading-options">{Array.from({ length: 4 }, (_, i) => <div className="builder-loading-group" key={i}><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><div>{Array.from({ length: i === 3 ? 5 : 3 }, (_, j) => <span className="skeleton-line skeleton-option" key={j}/>)}</div></div>)}</div><aside className="builder-loading-summary"><span className="skeleton-line skeleton-summary-picture"/><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-action"/></aside></div>; }

function BuilderGroup({ step, title, subtitle, options, value, onChange }) { return <div className="builder-group"><div className="builder-step"><span>{step}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="option-list">{options.map(option => <button key={option.id} disabled={option.available === false} aria-pressed={value === option.id} className={`builder-option ${value === option.id ? 'chosen' : ''}`} onClick={() => onChange(option.id)}><span className="radio-dot"/><span>{option.name}</span><small>{option.price === 0 ? 'Included' : `+${currency(option.price)}`}</small></button>)}</div></div>; }
function Ingredient({ label, value }) { return <div className="ingredient-row"><span>{label}</span><b>{value || 'Not selected'}</b></div>; }
function OrderCard({ order, admin = false, onStatus, onReorder }) { const current = ORDER_STEPS.findIndex(s => s.id === order.status); const paid = order.paymentStatus === 'paid'; const refunded = order.paymentStatus === 'refunded'; const cancelled = order.status === 'cancelled'; const reviewNeeded = Boolean(order.paymentReviewRequired) || order.status === 'payment_review';
    const canRepeat = !admin && !reviewNeeded && ['delivered', 'cancelled'].includes(order.status) && Array.isArray(order.items) && order.items.length > 0; const next = order.status === 'order_received' ? 'in_kitchen' : order.status === 'in_kitchen' ? 'sent_to_delivery' : order.status === 'sent_to_delivery' ? 'delivered' : null; return <article className="order-card"><div className="order-card-top"><div><span className="eyebrow">ORDER {order.orderNumber}</span><h3>{order.items?.map(i => `${i.quantity}× ${i.name}`).join(', ') || 'Pizza order'}</h3><p>{admin && order.user ? `${order.user.name} · ${order.user.email}` : new Date(order.createdAt).toLocaleString()} · {currency(order.total)}</p>{order.deliveryDetails && <div className="order-delivery-details"><small><strong>Deliver to:</strong> {order.deliveryDetails.recipientName} · {order.deliveryDetails.addressLine}, {order.deliveryDetails.city}, {order.deliveryDetails.state} {order.deliveryDetails.postalCode}</small><small><strong>Mobile:</strong> {order.deliveryDetails.phone}</small>{order.deliveryDetails.landmark && <small><strong>Landmark:</strong> {order.deliveryDetails.landmark}</small>}{order.deliveryDetails.instructions && <small><strong>Note:</strong> {order.deliveryDetails.instructions}</small>}</div>}</div><span className={`status-pill ${reviewNeeded ? 'review' : refunded ? 'refunded' : cancelled ? 'cancelled' : paid ? 'paid' : 'waiting'}`}>{reviewNeeded ? '⚠ Review required' : refunded ? '↺ Refunded' : cancelled ? '× Cancelled' : paid ? '● Paid' : '○ Payment pending'}</span></div>{reviewNeeded ? <div className="payment-review-warning" role="alert"><strong>Payment captured — order on hold.</strong><p>This order needs a manual payment and inventory review before kitchen preparation or delivery.</p>{admin && order.paymentReviewReason && <small>Reason: {order.paymentReviewReason.replaceAll('_', ' ')}</small>}</div> : refunded ? <div className="pending-message"><ShieldCheck size={15}/> Full refund confirmed; order cancelled.</div> : cancelled ? <div className="pending-message"><X size={15}/> This unpaid order expired and was cancelled. Start a new checkout to order again.</div> : paid ? <div className="order-timeline">{ORDER_STEPS.map((step, i) => <div key={step.id} className={`timeline-step ${i <= current ? 'complete' : ''} ${i === current ? 'current' : ''}`}><span className="timeline-icon"><step.icon size={16}/></span><small>{step.label}</small></div>)}</div> : <div className="pending-message"><Clock3 size={15}/> Waiting for a verified payment before kitchen preparation.</div>}{admin && next && paid && !reviewNeeded && <div className="order-admin-actions"><span>Update status</span><button className="button button-light small-button" onClick={() => onStatus(order, next)}>Move to {next.replaceAll('_', ' ')} <ArrowRight size={15}/></button></div>}{canRepeat && <div className="order-repeat-actions"><p>Want this one again? We’ll use the current menu and prices, not the old total.</p><button type="button" className="button button-light small-button" onClick={() => onReorder?.(order)}><RefreshCw size={16}/> Order again</button></div>}</article>; }

function InventoryRow({ item, onSave }) {
    const [stock, setStock] = useState(String(item.stock));
    const [threshold, setThreshold] = useState(String(item.lowStockThreshold));
    useEffect(() => {
        setStock(String(item.stock));
        setThreshold(String(item.lowStockThreshold));
    }, [item.stock, item.lowStockThreshold]);
    const changed = Number(stock) !== item.stock || Number(threshold) !== item.lowStockThreshold;

    return <div className="inventory-row">
        <div className="inventory-item-name"><b>{item.name}</b><small>{item.category}</small></div>
        <label className="inventory-number-field">
            <span className="inventory-number-label">In stock</span>
            <input aria-label={item.name + ' stock'} type="number" min="0" step="1" inputMode="numeric"
                value={stock} onChange={e => setStock(e.target.value)}/>
        </label>
        <label className="inventory-number-field">
            <span className="inventory-number-label">Alert at</span>
            <input aria-label={item.name + ' low stock threshold'} type="number" min="0" step="1" inputMode="numeric"
                value={threshold} onChange={e => setThreshold(e.target.value)}/>
        </label>
        <div className="inventory-state">
            <span className={`stock-dot ${item.stock <= item.lowStockThreshold ? 'low' : ''}`}/>
            <span>{item.stock <= item.lowStockThreshold ? 'Low stock' : 'Healthy'}</span>
            {changed && <button type="button" onClick={() => onSave(item, { stock, lowStockThreshold: threshold })}>Save</button>}
        </div>
    </div>;
}
async function loadRazorpay() { if (window.Razorpay)
    return; await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = resolve; script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.')); document.body.appendChild(script); }); }

function PriceReviewDialog({ review, catalog, pending, onAccept, onCancel }) {
    const dialogRef = useRef(null);
    useEffect(() => { dialogRef.current?.focus(); }, []);
    const serverItems = Array.isArray(review.serverOrder?.items) ? review.serverOrder.items : [];
    const rowCount = Math.max(review.previousItems.length, serverItems.length);
    const optionName = (group, id) => catalog?.[group]?.find(option => option.id === id)?.name || id || 'Not selected';
    const describeRecipe = (recipe = {}) => [
        'Base: ' + optionName('bases', recipe.base),
        'Sauce: ' + optionName('sauces', recipe.sauce),
        'Cheese: ' + optionName('cheeses', recipe.cheese),
        'Toppings: ' + ((Array.isArray(recipe.vegetables) && recipe.vegetables.length)
            ? recipe.vegetables.map(id => optionName('vegetables', id)).join(', ')
            : 'None'),
    ].join(' · ');

    return <div className="modal-backdrop price-review-backdrop" role="presentation"
        onMouseDown={event => event.target === event.currentTarget && !pending && onCancel()}>
        <section className="price-review-modal" role="dialog" aria-modal="true"
            aria-labelledby="price-review-title" aria-describedby="price-review-description"
            tabIndex={-1} ref={dialogRef}
            onKeyDown={event => event.key === 'Escape' && !pending && onCancel()}>
            <div className="price-review-heading">
                <span className="auth-brand-mark">P<span>.</span></span>
                <div className="eyebrow">PRICE & RECIPE CHECK</div>
                <h2 id="price-review-title">One quick check before you pay.</h2>
                <p id="price-review-description">The server's saved order differs from the price or recipe shown in your bag. No payment has been started and no stock has been reserved. Review the exact quote before accepting it.</p>
            </div>
            <div className="price-review-lines" aria-label="Item-by-item quote comparison">
                {Array.from({ length: rowCount }, (_, index) => {
                    const previous = review.previousItems[index];
                    const current = serverItems[index];
                    const oldRecipe = review.cartSnapshot?.[index]?.ingredients;
                    const nextRecipe = current?.ingredients;
                    const oldDescription = oldRecipe ? describeRecipe(oldRecipe) : '';
                    const nextDescription = nextRecipe ? describeRecipe(nextRecipe) : '';
                    const recipeChanged = Boolean(oldDescription && nextDescription && oldDescription !== nextDescription);
                    return <article className="price-review-item" key={(current?.name || previous?.name || 'item') + '-' + index}>
                        <div className="price-review-item-title">
                            <strong>{current?.name || previous?.name || ('Item ' + (index + 1))}</strong>
                            {previous && <small>Before: {previous.quantity} × {currency(previous.unitPrice)} = {currency(previous.lineTotal)}</small>}
                            {current && <small>Server quote: {current.quantity} × {currency(current.unitPrice)} = {currency(current.lineTotal)}</small>}
                            {!current && <small>This item is not present in the server quote.</small>}
                            {recipeChanged
                                ? <><small className="price-review-recipe-change">Previous recipe: {oldDescription}</small><small className="price-review-recipe-change">Updated recipe: {nextDescription}</small></>
                                : nextDescription && <small className="price-review-recipe">Recipe: {nextDescription}</small>}
                        </div>
                        <div className="price-review-item-total">
                            <span>Current quote</span>
                            <strong>{current ? currency(current.lineTotal) : 'Not included'}</strong>
                        </div>
                    </article>;
                })}
            </div>
            <div className="price-review-totals">
                <div><span>Previous subtotal</span><strong>{currency(review.previousSubtotal)}</strong></div>
                <div><span>Previous delivery</span><strong>{currency(review.previousDeliveryFee)}</strong></div>
                <div><span>Previous total</span><strong>{currency(review.previousTotal)}</strong></div>
                <div className="price-review-total-new"><span>Server subtotal</span><strong>{currency(review.serverOrder.subtotal)}</strong></div>
                <div><span>Server delivery</span><strong>{currency(review.serverOrder.deliveryFee)}</strong></div>
                <div className="price-review-grand-total"><span>New payable total</span><strong>{currency(review.serverOrder.total)}</strong></div>
            </div>
            <p className="price-review-safety-note"><ShieldCheck size={16}/> Accepting updates your bag only. You must review the updated total and press Checkout securely again before any payment begins.</p>
            <div className="price-review-actions">
                <button type="button" className="button button-light" disabled={pending} onClick={onCancel}>Keep my original bag</button>
                <button type="button" className="button button-dark" disabled={pending} onClick={onAccept}>
                    {pending ? <LoaderCircle size={17} className="spin"/> : <CheckCircle2 size={17}/>}
                    {pending ? 'Rechecking quote…' : 'Accept updated quote'}
                </button>
            </div>
        </section>
    </div>;
}

function PaymentRetryPanel({ pending, onRetry }) { return <div className="payment-retry-panel" role="alert"><strong>Payment needs confirmation</strong><p>We could not confirm the previous payment yet. Do not open another payment. Retry the server verification for the same payment.</p><button disabled={pending} className="button button-light full-button" onClick={onRetry}>{pending ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={16}/>} {pending ? 'Checking payment…' : 'Retry payment confirmation'}</button></div>; }
