import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, ChevronDown, Clock3, CreditCard, Flame, Leaf, LoaderCircle, LogIn, LogOut, Menu, Minus, Plus, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Truck, UserRound, X, CheckCircle2, CircleUserRound, PackageCheck, ChefHat, Boxes, RefreshCw, Mail, LockKeyhole, MessageCircle, Moon, Sun, UsersRound as UsersRoundIcon } from 'lucide-react';
import { io } from 'socket.io-client';
import { api, API_ORIGIN } from './api.js';
import PizzaArtwork from './PizzaArtwork.jsx';
import { getPizzaArtworkVariant } from './pizzaArtworkVariant.js';
import { THEME_STORAGE_KEY, readThemePreference, nextTheme } from './theme.js';
import { orderMatchesCart, classifyExistingCheckout, buildPendingCheckoutCart } from './checkout.js';
import { normalizeDeliveryDetails, mergeRestoredDeliveryDetails } from './delivery.js';
import { normalizeCatalogResponse, canCheckoutWithCatalog } from './catalog.js';
import { matchesCartSnapshot, requiresPriceConfirmation, sameServerQuote, snapshotCart, syncCartToServerQuote } from './priceReview.js';
import { buildReorderCart } from './reorder.js';
import { PENDING_PAYMENT_STORAGE_KEY, parsePendingVerification, serializePendingVerification } from './pendingPayment.js';
import { evaluateBudget } from './budgetGuard.js';
import { CHECKOUT_DRAFT_STORAGE_KEY, readCheckoutDraft, serializeCheckoutDraft, createCheckoutRequestId, hasDeliveryDetailsForUpdate as shouldUpdateDeliveryDetails } from './checkoutDraft.js';
import { classifySessionLookupFailure } from './sessionLookup.js';
import { completeSignOut } from './sessionLogout.js';
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
    { id: 'pesto-forest', name: 'Pesto Forest', description: 'Basil pesto, mushrooms, black olives and mozzarella.', price: 349, tag: 'FRESH PICK', emoji: '🍄', tone: 'green', ingredients: { base: 'thin', sauce: 'pesto', cheese: 'mozzarella', vegetables: ['mushroom', 'olive', 'onion'] } },
    { id: 'roasted-garden', name: 'Roasted Garden', description: 'Tomato, roasted-style peppers and garden vegetables.', price: 319, tag: 'BESTSELLER', emoji: '🫑', tone: 'tomato', ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['capsicum', 'tomato', 'onion'] } },
    { id: 'cornfire', name: 'Cornfire', description: 'Sweet corn, jalapeños and a lively arrabbiata finish.', price: 339, tag: 'SPICY', emoji: '🌽', tone: 'orange', ingredients: { base: 'pan', sauce: 'spicy-arrabbiata', cheese: 'cheddar', vegetables: ['corn', 'jalapeno', 'onion'] } },
    { id: 'olive-atelier', name: 'Olive Atelier', description: 'Whole-wheat crust, pesto, olives and plant-based cheese.', price: 379, tag: 'PLANT-BASED', emoji: '🫒', tone: 'cream', ingredients: { base: 'whole-wheat', sauce: 'pesto', cheese: 'vegan', vegetables: ['olive', 'mushroom', 'capsicum'] } },
];
const ORDER_STEPS = [{ id: 'order_received', label: 'Order received', icon: PackageCheck }, { id: 'in_kitchen', label: 'In the kitchen', icon: ChefHat }, { id: 'sent_to_delivery', label: 'On the way', icon: Truck }, { id: 'delivered', label: 'Delivered', icon: CheckCircle2 }];
const ISSUE_CATEGORY_LABELS = { missing_item: 'Missing item', wrong_item: 'Wrong item received', damaged_item: 'Damaged or spilled item', quality_issue: 'Food quality concern', delivery_delay: 'Delivery delay', payment_refund: 'Payment or refund question', other: 'Something else' };
const NEW_ISSUE_FORM = { category: 'missing_item', description: '' };
const EMPTY_DELIVERY_DETAILS = { recipientName: '', phone: '', addressLine: '', landmark: '', city: '', state: '', postalCode: '', instructions: '' };
const currency = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
function IconButton({ children, onClick, label, className = '', disabled = false }) { return <button type="button" aria-label={label} title={label} className={`icon-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>; }
function Toast({ toast, onClose }) {
    useEffect(() => {
        if (!toast) return;
        const id = setTimeout(onClose, 3600);
        return () => clearTimeout(id);
    }, [toast, onClose]);

    if (!toast) return null;
    const isError = toast.kind === 'error';
    return <div
        className={`toast ${toast.kind || ''}`}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        aria-atomic="true"
    >
        {isError ? <X size={17} aria-hidden="true"/> : <CheckCircle2 size={17} aria-hidden="true"/>}
        <span>{toast.message}</span>
        <button type="button" onClick={onClose} aria-label="Dismiss message"><X size={16} aria-hidden="true"/></button>
    </div>;
}

function Field({ label, icon: Icon, ...props }) { return <label className="field"><span>{label}</span><div className="field-input">{Icon && <Icon size={17}/>}<input {...props}/></div></label>; }
export default function App() {
    const [theme, setTheme] = useState(() => {
        try { return readThemePreference(window.localStorage); }
        catch { return 'light'; }
    });
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = theme === 'dark' ? '#07131e' : '#f5f8fb';
        try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* The visual theme still works without storage permission. */ }
    }, [theme]);
    const toggleTheme = () => setTheme(current => nextTheme(current));
    const [page, setPage] = useState('home');
    const [catalog, setCatalog] = useState(DEFAULT_CATALOG);
    const [featured, setFeatured] = useState(FEATURED);
    const [selectedPizza, setSelectedPizza] = useState(null);
    const [homeHeroPhotoLoaded, setHomeHeroPhotoLoaded] = useState(false);
    const [homeHeroPhotoFailed, setHomeHeroPhotoFailed] = useState(false);
    const [pizzaReturnPage, setPizzaReturnPage] = useState('menu');
    const [user, setUser] = useState(null);
    const [sessionStatus, setSessionStatus] = useState('checking');
    const [orders, setOrders] = useState([]);
    const [ordersStatus, setOrdersStatus] = useState('idle');
    const [ordersError, setOrdersError] = useState('');
    const ordersLoaded = useRef(false);
    const [adminStatus, setAdminStatus] = useState('idle');
    const [adminError, setAdminError] = useState('');
    const [paymentProviderCheck, setPaymentProviderCheck] = useState({ status: 'idle', checkedAt: null, message: '' });
    const [emailTest, setEmailTest] = useState({ status: 'idle', message: '' });
    const [paymentMode, setPaymentMode] = useState('loading');
    const adminLoaded = useRef(false);
    const [adminData, setAdminData] = useState({ summary: null, inventory: [], orders: [], paymentReviews: [], issues: [], staff: [], notificationHealth: null });
    const [opsData, setOpsData] = useState({ orders: [], role: null });
    const [opsStatus, setOpsStatus] = useState('idle');
    const [opsError, setOpsError] = useState('');
    const opsLoaded = useRef(false);
    const [issues, setIssues] = useState([]);
    const [issuesStatus, setIssuesStatus] = useState('idle');
    const [issuesError, setIssuesError] = useState('');
    const [issueReportOrder, setIssueReportOrder] = useState(null);
    const issueReportTriggerRef = useRef(null);
    const authDialogRef = useRef(null);
    const authTriggerRef = useRef(null);
    const authWasOpenRef = useRef(false);
    const mobileMenuTriggerRef = useRef(null);
    const pendingIssueFocusOrderId = useRef(null);
    const [issueForm, setIssueForm] = useState(NEW_ISSUE_FORM);
    const [pendingIssue, setPendingIssue] = useState(false);
    const [pendingAdminIssueId, setPendingAdminIssueId] = useState(null);
    const [catalogStatus, setCatalogStatus] = useState('loading');
    const [catalogError, setCatalogError] = useState('');
    const [pending, setPending] = useState(false);
    const [toast, setToast] = useState(null);
    const [authMode, setAuthMode] = useState(null);
    const [mobileMenu, setMobileMenu] = useState(false);
    const initialCheckoutDraft = useMemo(() => readCheckoutDraft(), []);
    const [cart, setCart] = useState(() => initialCheckoutDraft.cart);
    const [budgetLimit, setBudgetLimit] = useState('');
    const [deliveryDetails, setDeliveryDetails] = useState(EMPTY_DELIVERY_DETAILS);
    const [builder, setBuilder] = useState({ base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'corn'], quantity: 1 });
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [emailOnly, setEmailOnly] = useState('');
    const [resetToken, setResetToken] = useState(new URLSearchParams(location.search).get('resetToken') || '');
    const [filter, setFilter] = useState('All');
    const [activeOrderId, setActiveOrderId] = useState(() => initialCheckoutDraft.activeOrderId);
    const [checkoutRequestId, setCheckoutRequestId] = useState(() => initialCheckoutDraft.checkoutRequestId || null);
    const [deliveryRestoreStatus, setDeliveryRestoreStatus] = useState(() => initialCheckoutDraft.activeOrderId ? 'loading' : 'idle');
    const [deliveryRestoreRetry, setDeliveryRestoreRetry] = useState(0);
    const [priceReview, setPriceReview] = useState(null);
    const [pendingRefundOrderId, setPendingRefundOrderId] = useState(null);
    const [pendingStatusOrderId, setPendingStatusOrderId] = useState(null);
    const [pendingAssignmentOrderId, setPendingAssignmentOrderId] = useState(null);
    const [pendingVerification, setPendingVerification] = useState(() => {
        try {
            return parsePendingVerification(sessionStorage.getItem(PENDING_PAYMENT_STORAGE_KEY));
        } catch {
            return null;
        }
    });
    useEffect(() => {
        let cancelled = false;
        void api('/config').then(result => {
            if (cancelled) return;
            setPaymentMode(result?.paymentMode === 'live' || result?.paymentMode === 'test' ? result.paymentMode : 'unavailable');
        }).catch(() => {
            if (!cancelled) setPaymentMode('unavailable');
        });
        return () => { cancelled = true; };
    }, []);
    const notify = useCallback((message, kind = 'success') => setToast({ message, kind }), []);
    const openIssueReport = useCallback((order, trigger) => {
        issueReportTriggerRef.current = trigger;
        const paymentOnly = Boolean(order?.paymentReviewRequired) ||
            order?.status === 'payment_review' || order?.status === 'cancelled' ||
            ['failed', 'refunded'].includes(order?.paymentStatus);
        setIssueForm({
            ...NEW_ISSUE_FORM,
            category: paymentOnly ? 'payment_refund' : 'missing_item',
        });
        setIssueReportOrder(order);
    }, []);
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
    const refreshMe = useCallback(async () => {
        setSessionStatus('checking');
        try {
            const d = await api('/auth/me');
            setUser(d.user);
            setSessionStatus('ready');
            return d.user;
        } catch (error) {
            const failure = classifySessionLookupFailure(error);
            if (failure === 'unauthenticated') {
                setUser(null);
                setSessionStatus('ready');
            } else {
                // A network/API failure is not proof that the visitor has signed out.
                setSessionStatus('unavailable');
            }
            return null;
        }
    }, []);
    useEffect(() => {
        let cancelled = false;
        if (!activeOrderId) {
            setDeliveryRestoreStatus('idle');
            return undefined;
        }
        // Payment verification has its own recovery panel; do not interrupt it with address loading.
        if (pendingVerification) {
            setDeliveryRestoreStatus('ready');
            return undefined;
        }
        if (sessionStatus === 'checking') return undefined;
        if (!user || user.role !== 'user') {
            setDeliveryRestoreStatus('needs-sign-in');
            return undefined;
        }

        setDeliveryRestoreStatus('loading');
        void (async () => {
            try {
                const response = await api('/orders/' + activeOrderId);
                const order = response?.order;
                if (order?.status === 'pending_payment' && order?.paymentStatus === 'pending') {
                    if (!order.deliveryDetails) throw new Error('Saved delivery details are unavailable');
                    const savedDetails = normalizeDeliveryDetails(order.deliveryDetails);
                    if (!cancelled) {
                        setDeliveryDetails(current => mergeRestoredDeliveryDetails(current, savedDetails));
                    }
                }
                if (!cancelled) setDeliveryRestoreStatus('ready');
            } catch {
                if (!cancelled) setDeliveryRestoreStatus('error');
            }
        })();

        return () => { cancelled = true; };
    }, [activeOrderId, user, sessionStatus, deliveryRestoreRetry, pendingVerification]);
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
        setIssuesStatus('loading');
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
    }, []);

    const refreshAdmin = useCallback(async () => {
        if (!adminLoaded.current) setAdminStatus('loading');
        setAdminError('');
        try {
            const [summaryResponse, inventoryResponse, orderResponse, paymentResponse, issueResponse, staffResponse, notificationResponse] = await Promise.all([
                api('/admin/summary'),
                api('/admin/inventory'),
                api('/admin/orders'),
                api('/admin/payment-reviews'),
                api('/admin/issues'),
                api('/admin/staff'),
                api('/admin/notification-health'),
            ]);
            if (!Array.isArray(inventoryResponse.items) || !Array.isArray(orderResponse.orders) ||
                !Array.isArray(paymentResponse.events) || !Array.isArray(issueResponse.issues) || !Array.isArray(staffResponse.staff) ||
                typeof notificationResponse.deliveryConfigured !== 'boolean' || !notificationResponse.counts ||
                !Array.isArray(notificationResponse.deadLetters)) {
                throw new Error('Invalid admin dashboard response');
            }
            setAdminData({
                summary: summaryResponse.summary,
                inventory: inventoryResponse.items,
                orders: orderResponse.orders,
                paymentReviews: paymentResponse.events,
                issues: issueResponse.issues,
                staff: staffResponse.staff,
                notificationHealth: notificationResponse,
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
    const refreshOps = useCallback(async () => {
        if (!opsLoaded.current) setOpsStatus('loading');
        setOpsError('');
        try {
            const result = await api('/ops/orders');
            if (!Array.isArray(result.orders) || !['kitchen', 'delivery'].includes(result.role)) {
                throw new Error('Invalid operations queue response');
            }
            setOpsData({ orders: result.orders, role: result.role });
            opsLoaded.current = true;
            setOpsStatus('ready');
            return true;
        } catch (error) {
            setOpsError('Your assigned queue could not be refreshed. No order status was changed.');
            if (!opsLoaded.current) setOpsStatus('error');
            return false;
        }
    }, []);
    useEffect(() => {
        try {
            if (!cart.length && !activeOrderId) {
                sessionStorage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
                if (checkoutRequestId) setCheckoutRequestId(null);
                return;
            }
            const saved = serializeCheckoutDraft({ cart, activeOrderId, checkoutRequestId });
            if (saved) sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, saved);
        } catch {
            // Storage can be disabled; keep checkout functional for the current page session.
        }
    }, [cart, activeOrderId, checkoutRequestId]);
    useEffect(() => {
        if (!pendingVerification) return;
        setPage('cart');
        notify('A previous payment still needs confirmation. Retry the same payment; do not pay again.', 'error');
    }, [notify, pendingVerification]);
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
        const orderId = pendingIssueFocusOrderId.current;
        if (!orderId || !['ready', 'error'].includes(issuesStatus)) return;
        const card = Array.from(document.querySelectorAll('[data-order-id]'))
            .find(element => element.dataset.orderId === orderId);
        const target = card?.querySelector('.issue-status-card') || issueReportTriggerRef.current;
        target?.focus();
        pendingIssueFocusOrderId.current = null;
    }, [issues, issuesStatus]);
    useEffect(() => {
        if (user?.role === 'admin' && page === 'admin') void refreshAdmin();
        if (['kitchen', 'delivery'].includes(user?.role) && user.mustChangePassword !== true && page === user.role) void refreshOps();
    }, [user, page, refreshAdmin, refreshOps]);
    useEffect(() => {
        if (page !== 'home') return;
        if (user?.role === 'kitchen') setPage('kitchen');
        else if (user?.role === 'delivery') setPage('delivery');
    }, [user?.role, page]);
    useEffect(() => {
        if (!user || (['kitchen', 'delivery'].includes(user.role) && user.mustChangePassword === true)) return;
        const socket = io(API_ORIGIN, { withCredentials: true });
        const synchronizeOrders = () => {
            if (user.role === 'admin') refreshAdmin();
            else if (['kitchen', 'delivery'].includes(user.role)) refreshOps();
            else refreshOrders();
        };
        socket.on('connect', synchronizeOrders);
        socket.on('order:update', synchronizeOrders);
        socket.on('admin:refresh', synchronizeOrders);
        socket.on('ops:refresh', synchronizeOrders);
        socket.on('connect_error', (error) => {
            console.warn('Live order updates unavailable:', error.message);
        });
        return () => socket.disconnect();
    }, [user, refreshOrders, refreshAdmin, refreshOps]);
    const builderPrice = useMemo(() => { const find = (group, id) => catalog[group]?.find(x => x.id === id)?.price || 0; return 199 + find('bases', builder.base) + find('sauces', builder.sauce) + find('cheeses', builder.cheese) + builder.vegetables.reduce((sum, id) => sum + find('vegetables', id), 0); }, [catalog, builder]);
    const builderPreviewPhoto = getPizzaCardPhoto({ name: 'Your creation', ingredients: { base: builder.base, sauce: builder.sauce, cheese: builder.cheese, vegetables: builder.vegetables } }, 0);
    const builderPreviewVariant = getPizzaArtworkVariant({ name: 'Your creation', sauce: builder.sauce, cheese: builder.cheese, vegetables: builder.vegetables }, 0);
    const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const deliveryFee = subtotal >= 499 ? 0 : cart.length ? 29 : 0;
    const budgetStatus = evaluateBudget(subtotal + deliveryFee, budgetLimit);
    const budgetFeedback = !budgetStatus.configured
        ? 'Optional: leave this blank to skip the budget limit.'
        : !budgetStatus.valid
            ? 'Enter a whole-rupee amount of at least ₹1, or clear the field.'
            : budgetStatus.withinBudget
                ? `${currency(budgetStatus.remaining)} left in your budget.`
                : `${currency(budgetStatus.overBy)} over your budget. Remove items or adjust your limit to continue.`;
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
    const openPizzaDetails = (pizza) => {
        setSelectedPizza(pizza);
        setPizzaReturnPage(page === 'home' ? 'home' : 'menu');
        navigate('pizza-detail');
    };
    const openAuth = (mode) => { authTriggerRef.current = document.activeElement; setToast(null); setAuthMode(mode); setForm({ name: '', email: '', password: '' }); setEmailOnly(''); };
    useEffect(() => {
        if (!authMode) {
            if (authWasOpenRef.current) {
                const trigger = authTriggerRef.current;
                if (trigger?.isConnected) trigger.focus();
                else {
                    const fallback = document.querySelector('.dashboard-top h1, .admin-heading h1, .site-header .brand');
                    if (fallback) {
                        if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
                        fallback.focus();
                    }
                }
                authTriggerRef.current = null;
                authWasOpenRef.current = false;
            }
            return;
        }

        authWasOpenRef.current = true;
        const dialog = authDialogRef.current;
        if (!dialog) return;
        const initial = dialog.querySelector('input:not([disabled])') || dialog.querySelector('button:not([disabled])');
        initial?.focus();
        const focusableElements = () => Array.from(dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setAuthMode(null);
                return;
            }
            if (event.key !== 'Tab') return;
            const elements = focusableElements();
            if (!elements.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (!dialog.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [authMode]);
    useEffect(() => {
        if (mobileMenu) {
            document.querySelector('.main-nav button:not([disabled])')?.focus();
            return;
        }
        // While the auth modal is open, its focus manager owns focus. Do not
        // restore focus to the mobile toggle underneath the modal backdrop.
        if (authMode) {
            mobileMenuTriggerRef.current = null;
            return;
        }
        const trigger = mobileMenuTriggerRef.current;
        if (trigger?.isConnected) trigger.focus();
        mobileMenuTriggerRef.current = null;
    }, [mobileMenu, authMode]);
    const resendVerificationEmail = async () => {
        if (!String(form.email || '').trim()) {
            notify('Enter your email address first.', 'error');
            return;
        }
        setPending(true);
        try {
            const result = await api('/auth/resend-verification', { method: 'POST', body: { email: form.email } });
            notify(result.message || 'If an account needs verification, a new link will be sent.');
        } catch (error) {
            notify(error.message, 'error');
        } finally {
            setPending(false);
        }
    };
    const submitAuth = async (e) => { e.preventDefault(); setPending(true); try {
        if (authMode === 'register') {
            const result = await api('/auth/register', { method: 'POST', body: form });
            notify(result.message || 'Account created. You can now sign in.');
            setAuthMode('login');
        }
        else if (authMode === 'login' || authMode === 'admin' || authMode === 'staff') {
            const loginPath = authMode === 'admin' ? '/auth/admin/login' : authMode === 'staff' ? '/auth/staff/login' : '/auth/login';
            const d = await api(loginPath, { method: 'POST', body: form });
            setUser(d.user);
            setSessionStatus('ready');
            setAuthMode(null);
            setPage(d.user.role === 'admin' ? 'admin' : d.user.role === 'kitchen' ? 'kitchen' : d.user.role === 'delivery' ? 'delivery' : 'dashboard');
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
    const signOut = async () => {
        if (pendingVerification) {
            notify('Confirm the previous payment before signing out so you can safely retry verification.', 'error');
            navigate('cart');
            return;
        }
        if (pending) return;

        await completeSignOut({
            request: api,
            clearLocalSession: () => {
                setUser(null);
                setSessionStatus('ready');
                setOrders([]);
                ordersLoaded.current = false;
                setOrdersStatus('idle');
                setOrdersError('');
                setAdminData({ summary: null, inventory: [], orders: [], paymentReviews: [], issues: [], staff: [], notificationHealth: null });
                setOpsData({ orders: [], role: null });
                setOpsStatus('idle');
                setOpsError('');
                opsLoaded.current = false;
                adminLoaded.current = false;
                setAdminStatus('idle');
                setAdminError('');
                setCart([]);
                setDeliveryDetails(EMPTY_DELIVERY_DETAILS);
                setDeliveryRestoreStatus('idle');
                setDeliveryRestoreRetry(0);
                setActiveOrderId(null);
                setPage('home');
                notify('You have signed out.');
            },
            onError: () => notify("We couldn't confirm sign-out. Check your connection and try again.", 'error'),
        });
    };
    const addFeatured = (pizza, requestedQuantity = 1) => { const requested = Math.max(1, Math.min(10, Number(requestedQuantity) || 1)); const existing = cart.find(x => x.cartKey === `featured:${pizza.id}`); const quantity = existing ? Math.min(requested, Math.max(0, 10 - Number(existing.quantity || 0))) : requested; if (quantity < 1) { notify(`You can add up to 10 ${pizza.name} in one bag.`, 'error'); return; } setCart(existing ? cart.map(x => x.cartKey === existing.cartKey ? { ...x, quantity: Math.min(10, x.quantity + quantity) } : x) : [...cart, { cartKey: `featured:${pizza.id}`, type: 'featured', pizzaId: pizza.id, name: pizza.name, emoji: pizza.emoji, unitPrice: pizza.price, quantity, ingredients: pizza.ingredients }]); notify(`${quantity} × ${pizza.name} added to your bag`); };
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
    const resumePendingPayment = async (orderSummary) => {
        if (pending) return;
        if (pendingVerification) {
            notify('Confirm the previous payment before opening another checkout. Do not pay again yet.', 'error');
            navigate('cart');
            return;
        }
        if (!user || user.role !== 'user') {
            openAuth('login');
            notify('Sign in with the customer account to resume this checkout.', 'error');
            return;
        }
        if (catalogStatus !== 'ready') {
            notify('The live catalog must load before this saved order can be resumed.', 'error');
            navigate('menu');
            if (catalogStatus === 'error') void refreshCatalog();
            return;
        }
        if (!orderSummary?.id) {
            notify('We could not identify that saved order. Refresh your order history.', 'error');
            return;
        }

        const orderId = String(orderSummary.id);
        if (cart.length && String(activeOrderId || '') !== orderId &&
            !window.confirm('Replace your current bag with this saved unpaid order? Your current bag will be cleared.')) return;

        setPending(true);
        try {
            const response = await api('/orders/' + orderId);
            const savedOrder = response?.order;
            const restored = buildPendingCheckoutCart(savedOrder, catalog, featured);
            if (!restored.ok) {
                await refreshOrders();
                notify(restored.message, 'error');
                return;
            }

            let savedDeliveryDetails;
            try {
                savedDeliveryDetails = normalizeDeliveryDetails(savedOrder.deliveryDetails);
            } catch (error) {
                notify(error.message || 'The saved delivery address is incomplete. Update it before paying.', 'error');
                return;
            }

            const draft = serializeCheckoutDraft({
                cart: restored.items,
                activeOrderId: orderId,
                checkoutRequestId: null,
            });
            if (!draft) {
                notify('The saved cart could not be restored safely. No checkout was started.', 'error');
                return;
            }

            setCart(restored.items);
            setActiveOrderId(orderId);
            setCheckoutRequestId(null);
            setDeliveryDetails(savedDeliveryDetails);
            setDeliveryRestoreStatus('ready');
            setPriceReview(null);
            try {
                sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, draft);
            } catch {
                // Current in-memory state remains usable when session storage is unavailable.
            }
            navigate('cart');
            notify('Pending order restored using its saved server price. Review the address and total, then retry payment.');
        } catch (error) {
            notify(error.message || 'We could not restore this pending order. Refresh your order history and try again.', 'error');
        } finally {
            setPending(false);
        }
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
        if (!['test', 'live'].includes(paymentMode)) {
            notify('Payment mode could not be confirmed. Reload the page before starting checkout.', 'error');
            return;
        }
        if (!cart.length) return;
        if (!budgetStatus.withinBudget) {
            notify(budgetStatus.valid
                ? `Your bag is ${currency(budgetStatus.overBy)} over the budget you set. Update your bag or budget before checkout.`
                : 'Enter a valid whole-rupee budget of at least ₹1, or clear the budget field.', 'error');
            return;
        }
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

        let normalizedDeliveryDetails = null;
        const hasDeliveryDetailsForUpdate = shouldUpdateDeliveryDetails(deliveryDetails);
        // A restored pending order already has server-stored delivery details. If we could not
        // reload them, require the customer to provide a complete address before retrying.
        if (!activeOrderId || hasDeliveryDetailsForUpdate || deliveryRestoreStatus === 'error') {
            try {
                normalizedDeliveryDetails = normalizeDeliveryDetails(deliveryDetails);
            } catch (error) {
                notify(error.message, 'error');
                return;
            }
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
                    } else if (normalizedDeliveryDetails) {
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
                if (!normalizedDeliveryDetails) {
                    try {
                        normalizedDeliveryDetails = normalizeDeliveryDetails(deliveryDetails);
                    } catch (error) {
                        notify(error.message, 'error');
                        return;
                    }
                }
                let requestId = checkoutRequestId;
                if (!requestId) {
                    requestId = createCheckoutRequestId();
                    setCheckoutRequestId(requestId);
                    // Save the opaque retry key before the network request. Delivery details
                    // are deliberately excluded from session storage.
                    try {
                        const saved = serializeCheckoutDraft({ cart, activeOrderId: null, checkoutRequestId: requestId });
                        if (saved) sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, saved);
                    } catch {
                        // The current page can still retry in memory if storage is unavailable.
                    }
                }
                const created = await api('/orders', {
                    method: 'POST',
                    headers: { 'Idempotency-Key': requestId },
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
                setCheckoutRequestId(null);
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
            if (error.status === 409 && (error.code === 'CHECKOUT_IDEMPOTENCY_CONFLICT' || /This checkout request was already used with different details/i.test(error.message))) {
                // The cart or delivery data changed after an uncertain request. Forget that
                // key so a deliberate next click can create a new order rather than looping.
                setCheckoutRequestId(null);
                try {
                    const saved = serializeCheckoutDraft({ cart, activeOrderId: null, checkoutRequestId: null });
                    if (saved) sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, saved);
                } catch {
                    // The state still resets the in-memory key.
                }
                notify('Your previous checkout attempt used different details. Tap Checkout securely again to start a fresh order.', 'error');
                return;
            }
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

    const checkPaymentProvider = async () => {
        setPaymentProviderCheck({ status: 'loading', checkedAt: null, message: '', mode: paymentMode });
        try {
            const result = await api('/admin/payment-provider-check');
            setPaymentProviderCheck({ status: 'connected', checkedAt: result.checkedAt, message: '', mode: result.mode || paymentMode });
        } catch (error) {
            setPaymentProviderCheck({
                status: 'error',
                checkedAt: null,
                message: error.message || `Razorpay ${paymentMode === 'live' ? 'Live' : 'Test'} Mode connection could not be confirmed.`,
                mode: paymentMode,
            });
        }
    };

    const sendAdminTestEmail = async () => {
        setEmailTest({ status: 'loading', message: 'Sending one test email to your admin sign-in address…' });
        try {
            const result = await api('/admin/test-email', { method: 'POST', body: {} });
            setEmailTest({ status: 'success', message: result.message || 'The provider accepted the test email. Check your inbox and spam folder.' });
        } catch (error) {
            setEmailTest({ status: 'error', message: error.message || 'The provider did not accept the test email. Check its configuration and retry.' });
        }
    };

    const updateInventory = async (item, values) => { try {
        const d = await api(`/admin/inventory/${encodeURIComponent(item.key)}`, { method: 'PATCH', body: { stock: Number(values.stock), lowStockThreshold: Number(values.lowStockThreshold) } });
        setAdminData(prev => ({ ...prev, inventory: prev.inventory.map(x => x.key === item.key ? d.item : x) }));
        notify(`${item.name} updated`);
    }
    catch (e) {
        notify(e.message, 'error');
    } };
    const confirmDelivery = async (order) => {
        setPendingStatusOrderId(order.id);
        try {
            const result = await api(`/orders/${order.id}/confirm-delivery`, { method: 'POST' });
            await refreshOrders();
            notify(result.order.paymentMode === 'test'
                ? `Test Mode simulation: receipt confirmation saved for ${order.orderNumber}. No physical delivery was verified.`
                : `Receipt confirmed for ${order.orderNumber}. Thank you.`);
        } catch (error) {
            notify(error.message || 'Delivery receipt could not be confirmed.', 'error');
        } finally {
            setPendingStatusOrderId(null);
        }
    };
    const updateStatus = async (order, status) => {
        setPendingStatusOrderId(order.id);
        try {
            const response = await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status } });
            await refreshAdmin();
            notify(response.fulfillmentMode === 'simulated'
                ? `Test Mode simulation: ${order.orderNumber} → ${status.replaceAll('_', ' ')}. No real kitchen or driver was contacted.`
                : `${order.orderNumber} moved to ${status.replaceAll('_', ' ')}`);
        } catch (e) {
            notify(e.message, 'error');
        } finally {
            setPendingStatusOrderId(null);
        }
    };
    const assignOrderStaff = async (order, assignments) => {
        setPendingAssignmentOrderId(order.id);
        try {
            const result = await api(`/admin/orders/${order.id}/assignments`, { method: 'PATCH', body: assignments });
            await refreshAdmin();
            notify(`${order.orderNumber} assignments saved${result.order.fulfillmentMode === 'simulated' ? ' · Test Mode only' : ''}`);
        } catch (error) {
            notify(error.message || 'The staff assignment could not be saved.', 'error');
        } finally {
            setPendingAssignmentOrderId(null);
        }
    };
    const updateOpsStatus = async (order, status) => {
        setPendingStatusOrderId(order.id);
        try {
            const result = status === 'delivered'
                ? await api(`/ops/orders/${order.id}/request-delivery-confirmation`, { method: 'POST' })
                : await api(`/ops/orders/${order.id}/status`, { method: 'PATCH', body: { status } });
            await refreshOps();
            notify(status === 'delivered'
                ? (result.order.fulfillmentMode === 'simulated'
                    ? `Test Mode simulation: customer confirmation requested for ${order.orderNumber}. No physical delivery was verified.`
                    : `Customer receipt confirmation requested for ${order.orderNumber}.`)
                : result.order.fulfillmentMode === 'simulated'
                    ? `Simulated ${status.replaceAll('_', ' ')} saved for ${order.orderNumber}. No real kitchen or driver was contacted.`
                    : `${order.orderNumber} moved to ${status.replaceAll('_', ' ')}`);
        } catch (error) {
            notify(error.message || 'The order status could not be changed.', 'error');
        } finally {
            setPendingStatusOrderId(null);
        }
    };
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
        event.currentTarget.querySelector('textarea')?.focus();
        setPendingIssue(true);
        try {
            const response = await api('/issues', {
                method: 'POST',
                body: { orderId: issueReportOrder.id, category: issueForm.category, description },
            });
            pendingIssueFocusOrderId.current = issueReportOrder.id;
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
        const confirmed = window.confirm(`${retry ? 'Retry the same' : 'Issue a'} full refund for ${order.orderNumber} in Razorpay ${(order.paymentMode || 'test') === 'live' ? 'Live' : 'Test'} Mode? This action cannot be automatically undone.`);
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
    const isOperationsStaff = ['kitchen', 'delivery'].includes(user?.role);
    const operationsHome = user?.role === 'kitchen' ? 'kitchen' : user?.role === 'delivery' ? 'delivery' : user?.role === 'admin' ? 'admin' : 'dashboard';
    return <div className="app-shell" data-cart-photo-release="catalog-photo-v1" data-notification-health-release="admin-notifications-v1" data-payment-mode-disclosure-release="sandbox-otp-v1" data-payment-review-support-release="payment-support-v1">
    <div className="announcement"><span><Sparkles size={13}/> A better way to choose your pizza.</span><span className="announcement-right">Live menu · Clear prices · Recipe details</span></div>
    <header className="site-header" data-mobile-auth-focus="dialog-first" data-payment-provider-check="readonly-admin-v1" data-auth-toast-fix="clear-stale-toast-v1"><a className="brand" href="#home" onClick={e => { e.preventDefault(); navigate('home'); }}><span className="brand-mark">P<span>.</span></span><span className="brand-name">pizza<span>house</span><small>LIVE MENU · CLEAR PRICES</small></span></a>
      <nav className={`main-nav ${mobileMenu ? 'open' : ''}`}>{!isOperationsStaff && <><button className={page === 'home' ? 'active' : ''} onClick={() => navigate('home')}>Home</button><button className={page === 'menu' ? 'active' : ''} onClick={() => navigate('menu')}>Our menu</button><button className={page === 'builder' ? 'active' : ''} onClick={() => navigate('builder')}>Build your own</button></>}{user && <button className={page === operationsHome ? 'active' : ''} onClick={() => navigate(operationsHome)}>{user.role === 'admin' ? 'Admin panel' : user.role === 'kitchen' ? 'Kitchen queue' : user.role === 'delivery' ? 'Delivery run' : 'My orders'}</button>}{!user && <button className="mobile-auth-link" onClick={() => { openAuth('login'); authTriggerRef.current = mobileMenuTriggerRef.current; setMobileMenu(false); }}>Sign in</button>}</nav>
      <div className="header-actions">{!isOperationsStaff && <button className="bag-button" onClick={() => navigate('cart')}><ShoppingBag size={18}/><span>Bag</span><b>{cart.reduce((n, x) => n + x.quantity, 0)}</b></button>}<button type="button" className="theme-toggle" data-theme-toggle aria-label={theme === 'light' ? 'Switch to night mode' : 'Switch to light mode'} title={theme === 'light' ? 'Switch to night mode' : 'Switch to light mode'} aria-pressed={theme === 'dark'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={17} aria-hidden="true"/> : <Sun size={17} aria-hidden="true"/>}<span className="sr-only">{theme === 'light' ? 'Switch to night mode' : 'Switch to light mode'}</span></button>{user ? <><button className="account-button" onClick={() => navigate(operationsHome)}><CircleUserRound size={17}/><span>{user.name.split(' ')[0]}</span></button><IconButton className="logout-button" label="Sign out" disabled={pending || Boolean(pendingVerification)} onClick={signOut}><LogOut size={17}/></IconButton></> : <button className="sign-in" onClick={() => openAuth('login')}>Sign in <ArrowUpRight size={16}/></button>}{!isOperationsStaff && <IconButton className="mobile-toggle" label={mobileMenu ? 'Close menu' : 'Open menu'} onClick={event => { if (!mobileMenu) mobileMenuTriggerRef.current = event.currentTarget; setMobileMenu(v => !v); }}>{mobileMenu ? <X size={20}/> : <Menu size={20}/>}</IconButton>}</div>
    </header>

    <main>
    {sessionStatus === 'unavailable' && !user && <div className="section-wrap session-check-warning"><InlineDataWarning message="We couldn't verify your existing sign-in session. You may still be signed in; retry the check or sign in again." onRetry={() => void refreshMe()}/></div>}
    {page === 'home' && <><section className="hero section-wrap"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot"/> MADE TO ORDER · PRICES SHOWN UP FRONT</div><h1>A better pizza<br/>starts with <em>your choice.</em></h1><p className="hero-description">Choose a house recipe or build your own. See ingredients and the current menu price before adding it to your bag.</p><div className="hero-actions"><button className="button button-dark" onClick={() => navigate('menu')}>Browse the menu <ArrowRight size={17}/></button><button className="text-link" onClick={() => navigate('builder')}>Build your pizza <ArrowUpRight size={16}/></button></div><div className="hero-proof"><div><div className="stars"><ShieldCheck size={14} aria-hidden="true"/> <span>Live menu</span></div><small>Ingredients and prices checked</small></div><div className="proof-divider"/><div><strong>{catalogStatus === 'ready' ? catalog.bases.length + catalog.sauces.length : '—'}</strong><small>base & sauce options</small></div></div></div><div className="hero-art" data-home-hero="premium-food-v1"><div className={`hero-pizza ${homeHeroPhotoLoaded ? 'has-photo' : ''}`}><PizzaArtwork variant="tomato" className="hero-pizza-artwork" />{!homeHeroPhotoFailed && <img className="hero-pizza-photo" data-home-hero-photo="premium-food-v1" src={PIZZA_CARD_PHOTOS.mushroom.src} alt={PIZZA_CARD_PHOTOS.mushroom.alt} loading="eager" fetchPriority="high" decoding="async" onLoad={() => setHomeHeroPhotoLoaded(true)} onError={() => { setHomeHeroPhotoFailed(true); setHomeHeroPhotoLoaded(false); }}/>}</div></div></section>
      <section className="promise-strip"><div><span className="promise-icon"><Leaf size={20}/></span><div><b>Recipe details</b><small>See what's included</small></div></div><div><span className="promise-icon"><SlidersHorizontal size={20}/></span><div><b>Build your own</b><small>Choose each ingredient</small></div></div><div><span className="promise-icon"><CreditCard size={20}/></span><div><b>Clear pricing</b><small>Review totals before payment</small></div></div><div><span className="promise-icon"><ShieldCheck size={20}/></span><div><b>Server-checked orders</b><small>Price and payment validation</small></div></div></section>
      <section className="section-wrap menu-preview"><div className="section-heading"><div><div className="eyebrow">HOUSE FAVOURITES</div><h2>Find your <em>favourite.</em></h2><p>House recipes with clear ingredients and current menu prices.</p></div><button className="text-link" onClick={() => navigate('menu')}>The full menu <ArrowRight size={16}/></button></div>{catalogStatus === 'loading' ? <PizzaGridSkeleton count={3}/> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : featured.length ? <div className="pizza-grid">{featured.slice(0, 3).map((pizza, i) => <PizzaCard key={pizza.id} pizza={pizza} catalog={catalog} index={i} onAdd={(quantity) => addFeatured(pizza, quantity)} onCustomize={() => navigate('builder')} onViewDetails={() => openPizzaDetails(pizza)}/>)}</div> : <CatalogEmpty onRetry={refreshCatalog} />}<div className="custom-callout" data-home-builder-promo><div className="callout-icon"><ChefHat size={27} aria-hidden="true"/></div><div className="custom-callout-copy"><span>BUILD YOUR OWN</span><h3>A pizza made around your cravings.</h3><p>Choose your base, sauce, cheese and toppings. See your recipe and price before it goes into your bag.</p><div className="custom-callout-proof"><span><CheckCircle2 size={14}/> Live ingredient options</span><span><CheckCircle2 size={14}/> Price shown before checkout</span></div></div><button className="button button-light" onClick={() => navigate('builder')}>Create your pizza <ArrowRight size={17}/></button></div></section></>}

    {page === 'menu' && <section className="section-wrap page-section"><div className="page-intro"><div className="eyebrow">PICK YOUR HAPPY</div><h1>Every slice has<br /><em>a story.</em></h1><p>Choose a classic or get creative. Your cravings, your rules.</p></div>{catalogStatus === 'loading' ? <PizzaGridSkeleton count={6} full /> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : <><div className="filter-row"><div className="filter-label"><SlidersHorizontal size={16}/> Find your flavour</div>{['All', 'BESTSELLER', 'FRESH PICK', 'SPICY', 'PLANT-BASED'].map(f => <button className={`filter-chip ${filter === f ? 'selected' : ''}`} key={f} onClick={() => setFilter(f)}>{f === 'All' ? 'Everything' : f}</button>)}</div>{filteredPizzas.length ? <div className="pizza-grid full-grid">{filteredPizzas.map((pizza, i) => <PizzaCard key={pizza.id} pizza={pizza} catalog={catalog} index={i} onAdd={(quantity) => addFeatured(pizza, quantity)} onCustomize={() => navigate('builder')} onViewDetails={() => openPizzaDetails(pizza)}/>)}</div> : <CatalogEmpty onRetry={filter === 'All' ? refreshCatalog : () => setFilter('All')} emptyFilter={filter !== 'All'}/>}<div className="menu-bottom"><span>Can’t find your perfect slice?</span><button className="text-link" onClick={() => navigate('builder')}>Dream one up <ArrowRight size={16}/></button></div></>}</section>}

    {page === 'pizza-detail' && selectedPizza && <PizzaDetailView
      pizza={selectedPizza}
      catalog={catalog}
      index={Math.max(0, featured.findIndex((item) => item.id === selectedPizza.id))}
      returnLabel={pizzaReturnPage === 'home' ? 'Back to home' : 'Back to menu'}
      onBack={() => navigate(pizzaReturnPage)}
      onAdd={(quantity) => addFeatured(selectedPizza, quantity)}
      onCustomize={() => navigate('builder')}
    />}

    {page === 'builder' && <section className="section-wrap page-section"><div className="page-intro compact"><div className="eyebrow">YOUR PIZZA. YOUR RULES.</div><h1>The art of <em>your slice.</em></h1><p>Four little choices. One very personal pizza.</p></div>{catalogStatus === 'loading' ? <BuilderSkeleton/> : catalogStatus === 'error' ? <CatalogUnavailable onRetry={refreshCatalog} message={catalogError}/> : <div className="builder-layout"><div className="builder-steps"><BuilderGroup step="01" title="Start with the base" subtitle="The foundation of every good thing" options={catalog.bases} value={builder.base} onChange={v => setBuilder(p => ({ ...p, base: v }))}/><BuilderGroup step="02" title="Pick your sauce" subtitle="Set the mood" options={catalog.sauces} value={builder.sauce} onChange={v => setBuilder(p => ({ ...p, sauce: v }))}/><BuilderGroup step="03" title="Make it cheesy" subtitle="The good stuff" options={catalog.cheeses} value={builder.cheese} onChange={v => setBuilder(p => ({ ...p, cheese: v }))}/><div className="builder-group"><div className="builder-step"><span>04</span><div><h3>Top it your way</h3><p>Pick up to five. Go wild.</p></div><b>{builder.vegetables.length}/5</b></div><div className="veg-grid">{catalog.vegetables.map(v => <button key={v.id} disabled={v.available === false && !builder.vegetables.includes(v.id)} aria-pressed={builder.vegetables.includes(v.id)} className={`veg-option ${builder.vegetables.includes(v.id) ? 'chosen' : ''}`} onClick={() => setBuilder(p => ({ ...p, vegetables: p.vegetables.includes(v.id) ? p.vegetables.filter(x => x !== v.id) : p.vegetables.length < 5 ? [...p.vegetables, v.id] : p.vegetables }))}><span className="veg-check">{builder.vegetables.includes(v.id) ? '✓' : '+'}</span><span>{v.name}</span><small>+{currency(v.price)}</small></button>)}</div></div></div><aside className="builder-summary"><BuilderPhotoPreview key={builderPreviewPhoto.src} photo={builderPreviewPhoto} variant={builderPreviewVariant}/><div className="summary-body"><div className="eyebrow">LOOKS LIKE LOVE</div><h2>Your masterpiece.</h2><p className="summary-subtitle">Made just the way you like it.</p><div className="summary-ingredients"><Ingredient label="Base" value={catalog.bases.find(x => x.id === builder.base)?.name}/><Ingredient label="Sauce" value={catalog.sauces.find(x => x.id === builder.sauce)?.name}/><Ingredient label="Cheese" value={catalog.cheeses.find(x => x.id === builder.cheese)?.name}/><Ingredient label="Toppings" value={builder.vegetables.map(id => catalog.vegetables.find(x => x.id === id)?.name).filter(Boolean).join(', ') || 'No extras'}/></div><div className="summary-qty"><span>Quantity</span><div className="quantity-stepper"><IconButton label="Decrease quantity" onClick={() => setBuilder(p => ({ ...p, quantity: Math.max(1, p.quantity - 1) }))}><Minus size={14}/></IconButton><b>{builder.quantity}</b><IconButton label="Increase quantity" onClick={() => setBuilder(p => ({ ...p, quantity: Math.min(10, p.quantity + 1) }))}><Plus size={14}/></IconButton></div></div><div className="summary-total"><span>Your pizza</span><strong>{currency(builderPrice * builder.quantity)}</strong></div><button className="button button-dark full-button" onClick={addCustom}>Add to my bag <ArrowRight size={17}/></button><small className="summary-footnote"><ShieldCheck size={14}/> Server-checked price before payment.</small></div></aside></div>}</section>}

    {page === 'cart' && <section className="section-wrap page-section"><div className="eyebrow">THE GOOD STUFF</div><h1>Your little <em>bag of joy.</em></h1>{catalogStatus === 'loading' && <div className="catalog-checkout-notice" role="status"><LoaderCircle size={16} className="spin"/><span>Confirming current prices and availability before checkout…</span></div>}{catalogStatus === 'error' && <CatalogUnavailable onRetry={refreshCatalog} message={catalogError} />}{pendingVerification && <PaymentRetryPanel pending={pending} onRetry={retryPaymentVerification}/>}{activeOrderId && deliveryRestoreStatus === 'loading' && <div className="catalog-checkout-notice" role="status">Restoring the delivery details saved with your pending order…</div>}{activeOrderId && deliveryRestoreStatus === 'error' && <InlineDataWarning message="We couldn't reload the saved delivery address. Retry or re-enter all required delivery fields before checkout." onRetry={() => setDeliveryRestoreRetry(value => value + 1)}/>}{!cart.length ? <div className="empty-state"><div className="empty-art">🍕</div><h2>It’s a little empty in here.</h2><p>Your next favourite is only a slice away.</p><button className="button button-dark" onClick={() => navigate('menu')}>Find my pizza <ArrowRight size={17}/></button></div> : <div className="cart-layout"><div className="cart-lines">{cart.map((item, index) => <div className="cart-line" key={item.cartKey}><CartLinePhoto item={item} index={index}/><div className="cart-line-info"><span className="eyebrow">{item.type === 'custom' ? 'MADE BY YOU' : 'PIZZA HOUSE CLASSIC'}</span><h3>{item.name}</h3><p>{item.type === 'featured' ? 'Current house recipe' : `${catalog.bases.find(x => x.id === item.base)?.name || ''} · ${catalog.sauces.find(x => x.id === item.sauce)?.name || ''}`}</p><div className="quantity-stepper"><IconButton label="Decrease quantity" onClick={() => setQty(item.cartKey, -1)}><Minus size={14}/></IconButton><b>{item.quantity}</b><IconButton label="Increase quantity" onClick={() => setQty(item.cartKey, 1)}><Plus size={14}/></IconButton></div></div><div className="cart-line-price"><b>{currency(item.unitPrice * item.quantity)}</b><button onClick={() => removeCart(item.cartKey)}>Remove</button></div></div>)}<button className="text-link" onClick={() => navigate('menu')}>+ Add another pizza</button>
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
    </section></div><aside className="order-summary"><h2>Little details.</h2><div className="price-row"><span>Subtotal</span><b>{currency(subtotal)}</b></div><div className="price-row"><span>Delivery</span><b>{deliveryFee === 0 ? 'On us!' : currency(deliveryFee)}</b></div><div className="free-delivery-hint">{subtotal >= 499 ? 'Lovely — delivery is on us!' : `Add ${currency(499 - subtotal)} for free delivery.`}</div><div className="budget-guard"><label htmlFor="budget-limit">My maximum total <span>(optional)</span></label><div className="budget-guard-input"><span aria-hidden="true">₹</span><input id="budget-limit" type="number" min="1" step="1" inputMode="numeric" placeholder="e.g. 500" value={budgetLimit} onChange={event => setBudgetLimit(event.target.value)} aria-describedby="budget-guard-feedback" aria-invalid={budgetStatus.configured && !budgetStatus.valid}/></div><p id="budget-guard-feedback" className={`budget-guard-feedback${budgetStatus.valid && !budgetStatus.withinBudget ? ' over-budget' : ''}`} role={budgetStatus.valid && !budgetStatus.withinBudget ? 'alert' : 'status'} aria-live={budgetStatus.valid && !budgetStatus.withinBudget ? 'assertive' : 'polite'}>{budgetFeedback}</p>{budgetLimit !== '' && <button type="button" className="budget-clear" onClick={() => setBudgetLimit('')}>Clear budget limit</button>}</div><div className="summary-divider"/><div className="price-row final"><span>Total</span><b>{currency(subtotal + deliveryFee)}</b></div><button disabled={pending || Boolean(pendingVerification) || !canCheckoutWithCatalog(catalogStatus) || !budgetStatus.withinBudget || !['test', 'live'].includes(paymentMode) || Boolean(activeOrderId && deliveryRestoreStatus === 'loading')} className="button button-dark full-button" onClick={startCheckout}>{pending ? <LoaderCircle className="spin" size={17}/> : activeOrderId && deliveryRestoreStatus === 'loading' ? <LoaderCircle className="spin" size={17}/> : catalogStatus === 'ready' ? <CreditCard size={17}/> : <RefreshCw size={17}/>} {pending ? 'Getting checkout ready' : activeOrderId && deliveryRestoreStatus === 'loading' ? 'Restoring delivery details…' : pendingVerification ? 'Confirm previous payment first' : catalogStatus === 'loading' ? 'Confirming live prices…' : catalogStatus === 'error' ? 'Refresh menu before checkout' : 'Checkout securely'}</button><small className="summary-footnote"><ShieldCheck size={14}/> Payments secured by Razorpay</small><div className={`payment-mode-notice ${paymentMode === 'test' ? 'test' : paymentMode === 'live' ? 'live' : 'unavailable'}`} role="status" aria-live="polite" data-payment-mode-disclosure="sandbox-otp-v1">{paymentMode === 'test' ? <><strong>TEST MODE · Sandbox checkout</strong><span>The OTP screen is simulated. No SMS is sent and no real money is charged.</span><small>Use Razorpay test payment details to complete this sandbox flow.</small></> : paymentMode === 'live' ? <><strong>Live payments enabled</strong><span>Complete checkout only once; the order is confirmed after server-side payment verification.</span></> : <><strong>Payment mode unavailable</strong><span>Checkout stays guarded until the server confirms the configured mode.</span></>}</div></aside></div>}</section>}

    {page === 'dashboard' && <section className="section-wrap page-section"><div className="dashboard-top"><div><div className="eyebrow">YOUR PIZZA DIARY</div><h1>Good to see you, <em>{user?.name?.split(' ')[0] || 'friend'}.</em></h1><p>Every great day deserves a great slice.</p></div><button className="button button-light" onClick={() => navigate('menu')}>Order something lovely <ArrowRight size={16}/></button></div>{(ordersStatus === 'loading' || ordersStatus === 'idle') ? <DashboardMetricSkeleton/> : <div className="dashboard-metrics"><div><span>ORDERS MADE</span><strong>{ordersStatus === 'ready' ? orders.length.toString().padStart(2, '0') : '—'}</strong><small>{ordersStatus === 'ready' ? 'And counting' : 'Not available'}</small></div><div><span>ON THE WAY</span><strong>{ordersStatus === 'ready' ? orders.filter(o => ['order_received', 'in_kitchen', 'sent_to_delivery'].includes(o.status)).length.toString().padStart(2, '0') : '—'}</strong><small>{ordersStatus === 'ready' ? 'Good things incoming' : 'Not available'}</small></div><div><span>YOUR LAST ORDER</span><strong>{ordersStatus === 'ready' && orders[0] ? currency(orders[0].total) : '—'}</strong><small>{ordersStatus === 'ready' ? orders[0]?.orderNumber || 'Your first slice awaits' : 'Not available'}</small></div></div>}<div className="section-heading dashboard-heading"><div><h2>Order <em>updates.</em></h2><p>We’ll keep you in the loop. This list refreshes automatically.</p></div><button className="text-link" onClick={refreshOrders}><RefreshCw size={15}/> Refresh</button></div>{ordersError && ordersStatus === 'ready' && <InlineDataWarning message={ordersError} onRetry={refreshOrders} />}{issuesError && <InlineDataWarning message={issuesError} onRetry={refreshIssues} />}{(ordersStatus === 'loading' || ordersStatus === 'idle') ? <OrderListSkeleton count={2}/> : ordersStatus === 'error' ? <DataUnavailable title="Your orders haven’t loaded" message="We couldn’t confirm your order history. Please retry instead of assuming there are no orders." onRetry={refreshOrders}/> : orders.length ? <div className="orders-list">{orders.map(order => <OrderCard key={order.id} order={order} onReorder={repeatOrder} onResumePayment={resumePendingPayment} onConfirmDelivery={confirmDelivery} statusPending={pendingStatusOrderId === order.id} pending={pending} issue={issues.find(item => item.orderId === order.id)} onReportIssue={openIssueReport} onRefreshIssues={refreshIssues}/>)}</div> : <div className="empty-state compact-empty"><div className="empty-art">🥡</div><h2>The first one’s always special.</h2><p>Place an order and watch the magic happen here.</p><button className="button button-dark" onClick={() => navigate('menu')}>Explore the menu <ArrowRight size={17}/></button></div>}</section>}

    {page === 'admin' && <section className="section-wrap page-section admin-page"><div className="admin-heading"><div><div className="eyebrow">BEHIND THE COUNTER</div><h1>Good food takes <em>good care.</em></h1><p>Live order events refresh the queue. Use Refresh data to recheck inventory and payment status.</p></div><button className="button button-light" onClick={refreshAdmin}><RefreshCw size={16}/> Refresh data</button></div>{!user || user.role !== 'admin' ? <div className="empty-state"><div className="empty-art">🔐</div><h2>Admin access only.</h2><p>Sign in through the separate admin sign-in flow.</p><button className="button button-dark" onClick={() => openAuth('admin')}>Admin sign in <ArrowRight size={16}/></button></div> : (adminStatus === 'loading' || adminStatus === 'idle') ? <AdminPanelsSkeleton/> : adminStatus === 'error' ? <DataUnavailable title="Operations data isn’t available" message="Inventory, order and payment-review data could not be confirmed. Retry to load the live dashboard." onRetry={refreshAdmin}/> : <>{adminError && <InlineDataWarning message={adminError} onRetry={refreshAdmin}/>}<div className="admin-metrics">{[{ label: 'Total orders', value: adminData.summary?.ordersTotal ?? '—', icon: ShoppingBag }, { label: 'Paid orders', value: adminData.summary?.paidOrders ?? '—', icon: BadgeCheck }, { label: 'Revenue', value: currency(adminData.summary?.revenue), icon: ArrowUpRight }, { label: 'Low-stock items', value: adminData.summary?.lowStock ?? '—', icon: Boxes }].map(item => <div className="admin-metric" key={item.label}><span><item.icon size={17}/>{item.label}</span><strong>{item.value}</strong></div>)}</div><div className="admin-panel payment-provider-panel"><div className="panel-heading"><div><h2>Razorpay {paymentMode === 'live' ? 'Live Mode' : paymentMode === 'test' ? 'Test Mode' : 'Payment'} connection</h2><p>Verify the configured API key pair with a read-only request. No order, payment, or refund is created.</p></div><button type="button" className="button button-light small-button" disabled={paymentProviderCheck.status === 'loading'} onClick={checkPaymentProvider}>{paymentProviderCheck.status === 'loading' ? 'Checking…' : 'Check connection'}</button></div><p className={`provider-check-message ${paymentProviderCheck.status}`} role={paymentProviderCheck.status === 'error' ? 'alert' : 'status'} aria-live={paymentProviderCheck.status === 'error' ? 'assertive' : 'polite'}>{paymentProviderCheck.status === 'connected' ? `Connected to Razorpay ${(paymentProviderCheck.mode || paymentMode) === 'live' ? 'Live' : 'Test'} Mode at ${new Date(paymentProviderCheck.checkedAt).toLocaleString()}. Webhook delivery is a separate check.` : paymentProviderCheck.status === 'error' ? paymentProviderCheck.message : paymentProviderCheck.status === 'loading' ? 'Checking the provider with a read-only request…' : 'Not checked yet. This check does not create a payment, charge, order, or refund.'}</p></div><div className="admin-panel notification-health-panel" data-notification-health-panel="admin-notifications-v1">
<div className="panel-heading"><div><h2>Customer notifications</h2><p>Queue health and provider configuration. Credentials are never shown here.</p></div><div className="notification-heading-actions"><button type="button" className="button button-light small-button" disabled={emailTest.status === 'loading' || !adminData.notificationHealth?.deliveryConfigured} onClick={sendAdminTestEmail}>{emailTest.status === 'loading' ? 'Sending…' : 'Send test email'}</button><Mail size={20}/></div></div>
{!adminData.notificationHealth ? <div className="empty-small">Notification health is not available. Refresh the live operations data.</div> : <>
<div className={'notification-provider-state ' + (adminData.notificationHealth.deliveryConfigured ? 'configured' : 'missing')} role="status" aria-live="polite">
<span className="notification-provider-dot" aria-hidden="true"/>
<div><strong>{adminData.notificationHealth.deliveryConfigured ? 'Email provider settings detected' : 'Email provider not configured'}</strong><small>Checked {new Date(adminData.notificationHealth.checkedAt).toLocaleString()}</small></div>
</div>
{!adminData.notificationHealth.deliveryConfigured && <p className="notification-provider-note">Order emails stay queued until a Resend sender/key or SMTP settings are configured in Render. The test button stays disabled until provider settings are detected.</p>}{emailTest.status !== 'idle' && <p className={`notification-test-result ${emailTest.status}`} role={emailTest.status === 'error' ? 'alert' : 'status'} aria-live={emailTest.status === 'error' ? 'assertive' : 'polite'}>{emailTest.message}</p>}{adminData.notificationHealth.deliveryConfigured && <p className="notification-test-note">The button sends one email only to your current admin sign-in address. Provider acceptance is not proof of final inbox delivery.</p>}
<div className="notification-health-grid">
{[
{label:'Queued',count:adminData.notificationHealth.counts.queued,detail:'Waiting to send'},
{label:'Sending',count:adminData.notificationHealth.counts.sending,detail:'Delivery attempt in progress'},
{label:'Sent · 24h',count:adminData.notificationHealth.counts.sentLast24Hours,detail:'Provider accepted the message'},
{label:'Needs attention',count:adminData.notificationHealth.counts.dead,detail:'Retry limit reached'},
].map(item=><div className={'notification-health-metric ' + (item.label==='Needs attention' && item.count ? 'is-warning' : '')} key={item.label}><span>{item.label}</span><strong>{item.count}</strong><small>{item.detail}</small></div>)}
</div>
{adminData.notificationHealth.oldestQueuedAt && <p className="notification-queue-age">Oldest queued notification: {new Date(adminData.notificationHealth.oldestQueuedAt).toLocaleString()}</p>}
{adminData.notificationHealth.deadLetters.length ? <div className="notification-dead-letters"><h3>Failed delivery attempts</h3>{adminData.notificationHealth.deadLetters.map((item,index)=><div className="notification-dead-row" key={(item.orderNumber || 'unknown') + '-' + index}><div><strong>{item.orderNumber || 'Order reference unavailable'}</strong><small>{item.attempts} attempts · {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'Time unavailable'}</small></div><p>{item.lastError || 'No provider error detail recorded.'}</p></div>)}</div> : <p className="notification-clear-note">No notifications have exhausted their retry limit.</p>}
</>}
</div>
<div className="admin-panel"><div className="panel-heading"><div><h2>Inventory room</h2><p>Update stock counts and per-item alert thresholds.</p></div><Boxes size={20}/></div><div className="inventory-table"><div className="inventory-row inventory-header"><span>Item</span><span>In stock</span><span>Alert at</span><span>State</span></div>{adminData.inventory.length ? adminData.inventory.map(item => <InventoryRow key={item.key} item={item} onSave={updateInventory}/>) : <div className="empty-small">No inventory items were returned by the API.</div>}</div></div><div className="admin-panel"><div className="panel-heading"><div><h2>Payment review queue</h2><p>Signed webhook events needing manual reconciliation.</p></div><ShieldCheck size={20}/></div>{adminData.paymentReviews.length ? <div className="payment-review-list">{adminData.paymentReviews.map(event => <article className="payment-review-event" key={event.eventId}><div><strong>{event.eventType}</strong><small>{event.order?.orderNumber || 'Unmatched provider order'} · {new Date(event.receivedAt).toLocaleString()}</small></div><p>{event.reason?.replaceAll('_', ' ') || 'Manual review required'}</p><small>Provider order: {event.providerOrderId || 'not supplied'} · Payment: {event.paymentId || 'not supplied'}</small><small>Event ID: {event.eventId}</small>{event.order?.refundStatus === 'pending' && <p className="refund-status-note">Refund pending with Razorpay. Do not submit another refund.</p>}{event.order?.refundStatus === 'failed' && <p className="refund-status-note">Refund failed or was rejected. Manual provider review is required.</p>}{event.order?.id && event.order.status === 'payment_review' && event.order.paymentReviewRequired && event.order.paymentStatus === 'paid' && event.paymentId === event.order.razorpayPaymentId && event.reason !== 'multiple_captured_payments_for_order' && !adminData.paymentReviews.some(item => item.order?.id === event.order.id && item.paymentId && item.paymentId !== item.order?.razorpayPaymentId) && !['pending', 'processed', 'failed'].includes(event.order.refundStatus || 'none') && <div className="payment-review-actions"><small>{event.order.refundStatus === 'requested' ? 'A retry reuses the same provider idempotency key.' : 'Use only after reviewing the captured-payment exception.'}</small><button type="button" className="button button-light small-button" disabled={pendingRefundOrderId === event.order.id} onClick={() => requestReviewRefund(event)}>{pendingRefundOrderId === event.order.id ? 'Submitting…' : event.order.refundStatus === 'requested' ? 'Retry safely' : 'Issue full refund'}</button></div>}</article>)}</div> : <div className="empty-small">No payment webhook reviews are currently queued.</div>}</div><div className="admin-panel"><div className="panel-heading"><div><h2>Customer issue cases</h2><p>Track missing, wrong or damaged items, delivery delays, and payment/refund questions. Customer messages are visible to the customer.</p></div><MessageCircle size={20}/></div>{adminData.issues.length ? <div className="issue-case-list">{adminData.issues.map(issue => <AdminIssueCard key={issue.id} issue={issue} pending={pendingAdminIssueId === issue.id} onUpdate={updateIssue}/>)}</div> : <div className="empty-small">No customer issue reports are currently queued.</div>}</div><div className="admin-panel staff-management-panel"><div className="panel-heading"><div><h2>Kitchen &amp; delivery team</h2><p>Create named team accounts, disable access instantly and assign staff to orders.</p></div><UsersRoundIcon size={20}/></div><StaffManagement staff={adminData.staff} onRefresh={refreshAdmin} onNotify={notify}/></div><div className="admin-panel fulfillment-admin-panel"><div className="panel-heading"><div><h2>Kitchen &amp; dispatch</h2><p>Assign each order to named staff before the next hand-off.</p></div><ChefHat size={20}/></div><FulfillmentQueue orders={adminData.orders} staff={adminData.staff} role="admin" paymentMode={paymentMode} catalog={catalog} onStatus={updateStatus} onAssign={assignOrderStaff} pendingStatusOrderId={pendingStatusOrderId} pendingAssignmentOrderId={pendingAssignmentOrderId}/></div></>}</section>}

    {['kitchen', 'delivery'].includes(page) && <section className="section-wrap page-section admin-page staff-operations-page">
      {user?.mustChangePassword === true
        ? <StaffPasswordChangeForm onComplete={async nextUser => {
            setUser(nextUser);
            notify('Password updated. Your staff account is ready.');
            setOpsStatus('loading');
            await refreshOps();
          }}/>
        : <>
          <div className="admin-heading">
            <div><div className="eyebrow">{user?.role === 'kitchen' ? 'KITCHEN WORKSTATION' : 'DELIVERY RUN SHEET'}</div>
              <h1>{user?.role === 'kitchen' ? <>Kitchen <em>queue.</em></> : <>Your delivery <em>run.</em></>}</h1>
              <p>{user?.role === 'kitchen' ? 'Only orders assigned to your staff account appear here. Accept preparation, then hand off to an active delivery partner.' : 'Only orders assigned to your delivery account appear here. Confirm drop-off after the kitchen dispatches the order.'}</p>
            </div>
            <button className="button button-light" onClick={refreshOps} disabled={opsStatus === 'loading'}><RefreshCw size={16}/>{opsStatus === 'loading' ? 'Refreshing…' : 'Refresh queue'}</button>
          </div>
          {opsError && <InlineDataWarning message={opsError} onRetry={refreshOps}/>}
          {opsStatus === 'loading' || opsStatus === 'idle'
            ? <AdminPanelsSkeleton/>
            : opsStatus === 'error'
              ? <DataUnavailable title="Your assigned queue is unavailable" message="We could not verify the current staff queue. Retry; no order state has been changed." onRetry={refreshOps}/>
              : <div className="admin-panel fulfillment-admin-panel"><FulfillmentQueue orders={opsData.orders} role={user?.role} paymentMode={paymentMode} catalog={catalog} onStatus={updateOpsStatus} pendingStatusOrderId={pendingStatusOrderId}/></div>}
        </>}
    </section>}
    {['home', 'menu', 'pizza-detail', 'builder', 'cart', 'dashboard', 'admin'].includes(page) && <PageEndcap page={page} navigate={navigate} cartCount={cart.reduce((n, item) => n + item.quantity, 0)} catalogStatus={catalogStatus} featuredCount={featured.length} ordersCount={orders.length} ordersStatus={ordersStatus} paymentMode={paymentMode} pizzaName={selectedPizza?.name || ''} onRefresh={refreshAdmin}/>}
    </main>
    <footer className="site-footer"><div className="footer-main"><a className="brand footer-brand" href="#home" onClick={e => { e.preventDefault(); navigate('home'); }}><span className="brand-mark">P<span>.</span></span><span className="brand-name">pizza<span>house</span><small>LIVE MENU · CLEAR PRICES</small></span></a><p>House favourites and recipe-led choices.<br />Current menu details before checkout.</p><nav className="footer-nav" aria-label="Footer navigation">{isOperationsStaff ? <><span className="footer-nav-label">Workspace</span><button type="button" onClick={() => navigate(operationsHome)}>{user.role === 'kitchen' ? 'Kitchen queue' : 'Delivery run'}</button></> : <><span className="footer-nav-label">Explore</span><button type="button" onClick={() => navigate('home')}>Home</button><button type="button" onClick={() => navigate('menu')}>Menu</button><button type="button" onClick={() => navigate('builder')}>Build a pizza</button><button type="button" onClick={() => navigate('cart')}>Bag ({cart.reduce((n, item) => n + item.quantity, 0)})</button>{user && <button type="button" onClick={() => navigate(user.role === 'admin' ? 'admin' : 'dashboard')}>{user.role === 'admin' ? 'Operations' : 'My orders'}</button>}</>}</nav><button className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to the top <ArrowUpRight size={16}/></button></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Pizza House. House favourites and current menu prices.</span><div><span>Live menu pricing</span><span className="footer-dot">·</span><span>Payment verified before confirmation</span></div></div></footer>
    <Toast toast={toast} onClose={() => setToast(null)}/>
    {priceReview && <PriceReviewDialog review={priceReview} catalog={catalog} pending={pending} onAccept={acceptPriceReview} onCancel={declinePriceReview}/>}
    {issueReportOrder && <IssueReportDialog order={issueReportOrder} form={issueForm} setForm={setIssueForm} pending={pendingIssue} returnFocusRef={issueReportTriggerRef} onSubmit={submitIssueReport} onCancel={() => { if (!pendingIssue) { setIssueReportOrder(null); setIssueForm(NEW_ISSUE_FORM); } }}/>}
    {authMode && <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && setAuthMode(null)}><div className="auth-modal" ref={authDialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1}><IconButton className="modal-close" label="Close dialog" onClick={() => setAuthMode(null)}><X size={19}/></IconButton><div className="auth-brand-mark">P<span>.</span></div><div className="eyebrow">{['admin', 'staff'].includes(authMode) ? 'TEAM ACCESS' : 'COME ON IN'}</div><h2 id="auth-title">{authMode === 'register' ? 'Make yourself at home.' : authMode === 'forgot' ? 'A fresh start.' : authMode === 'reset' ? 'New password, new slice.' : authMode === 'admin' ? 'Welcome back, admin.' : authMode === 'staff' ? 'Welcome to the team.' : 'Your table is waiting.'}</h2><p>{authMode === 'register' ? 'Create an account to follow every lovely order.' : authMode === 'forgot' ? 'We’ll send a secure reset link if your account exists.' : authMode === 'reset' ? 'Choose a strong new password to get back in.' : authMode === 'admin' ? 'Sign in with your administrator account.' : authMode === 'staff' ? 'Kitchen and delivery accounts are provisioned by your administrator.' : 'Sign in for order updates and a little more pizza joy.'}</p><form onSubmit={submitAuth}>{authMode === 'register' && <Field label="Your name" icon={UserRound} placeholder="How should we call you?" autoComplete="name" required minLength={2} maxLength={80} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}/>}{authMode === 'forgot' && <Field label="Email address" icon={Mail} type="email" placeholder="you@example.com" required autoComplete="email" value={emailOnly} onChange={e => setEmailOnly(e.target.value)}/>}{!['forgot'].includes(authMode) && authMode !== 'reset' && <Field label="Email address" icon={Mail} type="email" placeholder="you@example.com" required autoComplete="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}/>}{(authMode === 'login' || authMode === 'register' || authMode === 'admin' || authMode === 'staff' || authMode === 'reset') && <Field label={authMode === 'reset' ? 'New password' : 'Password'} icon={LockKeyhole} type="password" placeholder={authMode === 'reset' ? '10+ characters, mixed case and a number' : 'At least 10 characters'} required minLength={10} autoComplete={authMode === 'login' || authMode === 'admin' || authMode === 'staff' ? 'current-password' : 'new-password'} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}/>}{['login', 'staff'].includes(authMode) && <button type="button" className="forgot-link" onClick={() => setAuthMode('forgot')}>Forgot password?</button>}{authMode === 'login' && <button type="button" className="forgot-link" disabled={pending} onClick={resendVerificationEmail}>Resend verification email</button>}<button disabled={pending} className="button button-dark full-button auth-submit">{pending ? <LoaderCircle size={17} className="spin"/> : authMode === 'reset' ? <LockKeyhole size={17}/> : authMode === 'forgot' ? <Mail size={17}/> : authMode === 'admin' || authMode === 'staff' ? <ShieldCheck size={17}/> : authMode === 'register' ? <UserRound size={17}/> : <LogIn size={17}/>} {pending ? 'Please wait…' : authMode === 'register' ? 'Create my account' : authMode === 'forgot' ? 'Send reset link' : authMode === 'reset' ? 'Update password' : authMode === 'admin' ? 'Sign in as admin' : authMode === 'staff' ? 'Sign in to operations' : 'Sign in'}</button></form>{authMode === 'login' ? <div className="auth-switch">New around here? <button onClick={() => setAuthMode('register')}>Create an account</button><button className="admin-link" onClick={() => setAuthMode('admin')}>Admin sign in</button><button className="admin-link" onClick={() => setAuthMode('staff')}>Kitchen / delivery sign in</button></div> : authMode === 'register' ? <div className="auth-switch">Already part of the house? <button onClick={() => setAuthMode('login')}>Sign in</button></div> : authMode === 'admin' || authMode === 'staff' ? <div className="auth-switch">Customer account? <button onClick={() => setAuthMode('login')}>Customer sign in</button></div> : <div className="auth-switch"><button onClick={() => setAuthMode('login')}>Back to sign in</button></div>}<small className="auth-privacy"><ShieldCheck size={13}/> Your details stay protected. We never store card numbers.</small></div></div>}
  </div>;
}
function PageEndcap({ page, navigate, cartCount = 0, catalogStatus = 'idle', featuredCount = 0, ordersCount = 0, ordersStatus = 'idle', paymentMode = 'unknown', pizzaName = '', onRefresh }) {
    const content = {
        home: {
            eyebrow: 'WELCOME TO PIZZA HOUSE',
            title: 'Make the next slice yours.',
            description: catalogStatus === 'ready'
                ? 'Explore the current house recipes, check what goes into each one, or build a pizza around your own taste.'
                : 'Browse the menu or start a custom recipe. Current ingredients and prices are confirmed from the live catalog before checkout.',
            primary: 'Browse the menu',
            secondary: 'Build your own',
            primaryTarget: 'menu',
            secondaryTarget: 'builder',
            items: [
                { icon: Leaf, title: 'House recipes', detail: catalogStatus === 'ready' ? `${featuredCount} featured recipe${featuredCount === 1 ? '' : 's'} connected to the current menu.` : 'Featured recipes load from the live menu when available.' },
                { icon: SlidersHorizontal, title: 'Made around you', detail: 'Choose a base, sauce, cheese and toppings in the custom pizza builder.' },
                { icon: ShieldCheck, title: 'Clear checkout', detail: 'Review the current cart total and let the server verify the quote before payment.' },
            ],
        },
        'pizza-detail': {
            eyebrow: 'ONE MORE LOOK',
            title: pizzaName ? `${pizzaName}, your way.` : 'Found a favourite?',
            description: 'Review the house recipe and current menu price above, then keep it as is or customise the combination to suit you.',
            primary: 'Back to the menu',
            secondary: 'Build your own',
            primaryTarget: 'menu',
            secondaryTarget: 'builder',
            items: [
                { icon: Leaf, title: 'Recipe in view', detail: 'Ingredient details stay attached to the selected house recipe.' },
                { icon: ShoppingBag, title: 'One current total', detail: 'Quantity changes update the visible subtotal before you add it to your bag.' },
                { icon: ChefHat, title: 'Make a change', detail: 'Open the builder to choose a different base, sauce, cheese or toppings.' },
            ],
        },
        menu: {
            eyebrow: 'ON THE MENU',
            title: 'Find your next favourite.',
            description: catalogStatus === 'ready'
                ? 'Menu prices and availability are connected to the live catalog. Pick a house favourite or build a combination that feels like yours.'
                : 'Choose your next step. Current prices and availability will be confirmed from the live menu before checkout.',
            primary: 'Build your own',
            secondary: 'Open your bag',
            primaryTarget: 'builder',
            secondaryTarget: 'cart',
            items: [
                { icon: Leaf, title: 'Your kind of flavour', detail: 'Explore house recipes or choose your own base, sauce, cheese and toppings.' },
                { icon: ShoppingBag, title: 'Live menu details', detail: catalogStatus === 'ready' ? 'The current catalog is loaded for prices and availability.' : 'The menu shows a retry state if live catalog data cannot be confirmed.' },
                { icon: ShieldCheck, title: 'A clear checkout', detail: 'Review the current order total before starting a payment.' },
            ],
        },
        builder: {
            eyebrow: 'CUSTOMISE YOUR PIZZA',
            title: 'Make it yours.',
            description: 'Build the recipe you actually want. Ingredient choices and prices come from the menu, and the bag gives you one more chance to review everything.',
            primary: 'Review my bag',
            secondary: 'Browse house favourites',
            primaryTarget: 'cart',
            secondaryTarget: 'menu',
            items: [
                { icon: ChefHat, title: 'Four simple steps', detail: 'Choose a base, sauce, cheese and up to five vegetable toppings.' },
                { icon: CheckCircle2, title: 'See the full recipe', detail: 'Your selection stays visible in the recipe summary while you customise.' },
                { icon: ShieldCheck, title: 'Review before paying', detail: 'Checkout verifies the server quote before a payment can begin.' },
            ],
        },
        cart: {
            eyebrow: 'YOUR BAG',
            title: cartCount ? 'Review your order before checkout.' : 'Start with a pizza you love.',
            description: catalogStatus === 'ready'
                ? 'Your current menu data is loaded. The server checks the quote and availability again when you continue to checkout.'
                : 'We will not treat demo prices as confirmed. Refresh the live menu before proceeding with checkout.',
            primary: cartCount ? 'Add another pizza' : 'Find a pizza',
            secondary: 'Build your own',
            primaryTarget: 'menu',
            secondaryTarget: 'builder',
            items: [
                { icon: ShoppingBag, title: cartCount ? `${cartCount} item${cartCount === 1 ? '' : 's'} in your bag` : 'Start with a favourite', detail: cartCount ? 'You can adjust quantities or remove an item before checkout.' : 'Add a house recipe or make a custom pizza to get started.' },
                { icon: Truck, title: 'Delivery details', detail: 'Check the address and contact details before confirming the order.' },
                { icon: ShieldCheck, title: paymentMode === 'test' ? 'Razorpay Test Mode' : paymentMode === 'live' ? 'Server-verified payment' : 'Payment mode check', detail: paymentMode === 'test' ? 'Test credentials only; this does not charge real money.' : paymentMode === 'live' ? 'The server confirms the provider result before the order is treated as paid.' : 'Checkout remains guarded until the payment mode is confirmed.' },
            ],
        },
        dashboard: {
            eyebrow: 'ORDER HISTORY',
            title: ordersStatus === 'ready'
                ? (ordersCount ? 'Your orders, all in one place.' : 'Your first order starts here.')
                : 'Order updates, in one place.',
            description: ordersStatus === 'ready'
                ? (ordersCount
                    ? 'Your order history is up to date. Reorder a favourite at today’s menu price or open an order for status updates and support.'
                    : 'No orders are saved to your account yet. Once you place one, its status and support options will appear here.')
                : ordersStatus === 'error'
                    ? 'Your order history could not be confirmed. Retry the history above instead of assuming it is empty.'
                    : 'Your order history and order updates are loading from your account.',
            primary: 'Order something lovely',
            secondary: 'View order updates',
            primaryTarget: 'menu',
            secondaryTarget: 'orders',
            items: [
                { icon: Clock3, title: ordersStatus === 'ready' ? (ordersCount ? `${ordersCount} order${ordersCount === 1 ? '' : 's'} on your account` : 'No orders yet') : 'Order history', detail: ordersStatus === 'error' ? 'Retry your history to load the latest order status.' : ordersStatus === 'ready' && !ordersCount ? 'Your order timeline will appear here after your first checkout.' : 'Open any order to see its latest status and stage history.' },
                { icon: RefreshCw, title: 'Reorder a favourite', detail: 'Use Reorder on a past order to rebuild your bag with current prices.' },
                { icon: MessageCircle, title: 'Need a hand?', detail: 'Open an order and choose Report an issue for missing items or delivery concerns.' },
            ],
        },
        admin: {
            eyebrow: 'ADMINISTRATION',
            title: 'Keep stock, payments and hand-offs clear.',
            description: 'Use the live operations panels above for inventory, payment review, customer cases and kitchen progress. This shortcut refreshes the current operational data only.',
            primary: 'Refresh live data',
            secondary: 'Jump to incoming orders',
            primaryTarget: 'refresh',
            secondaryTarget: 'incoming',
            items: [
                { icon: Boxes, title: 'Inventory', detail: 'Check stock counts and alert thresholds before changing availability.' },
                { icon: ShieldCheck, title: 'Payment review', detail: 'Reconcile provider events carefully; do not retry a refund blindly.' },
                { icon: PackageCheck, title: 'Order handoff', detail: 'Move confirmed orders through the kitchen and delivery status controls.' },
            ],
        },
    }[page];

    if (!content) return null;
    const goTo = (target) => {
        if (target === 'refresh') {
            onRefresh?.();
            return;
        }
        if (target === 'orders') {
            document.querySelector('.dashboard-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (target === 'incoming') {
            document.querySelector('.admin-page .admin-panel:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        navigate(target);
    };

    return <section className={`section-wrap page-endcap page-endcap-${page}`} data-page-endcap={page} data-featured-count={page === 'home' ? featuredCount : undefined} aria-labelledby={`page-endcap-title-${page}`}>
        <div className="page-endcap-main">
            <div className="eyebrow"><span className="page-endcap-eyebrow-mark" aria-hidden="true" />{content.eyebrow}</div>
            <h2 id={`page-endcap-title-${page}`}>{content.title}</h2>
            <p>{content.description}</p>
            <div className="page-endcap-actions">
                <button type="button" className="button button-dark" onClick={() => goTo(content.primaryTarget)}>{content.primary} <ArrowRight size={16}/></button>
                <button type="button" className="page-endcap-secondary" onClick={() => goTo(content.secondaryTarget)}>{content.secondary} <ArrowUpRight size={15}/></button>
            </div>
        </div>
        <div className="page-endcap-benefits">
            {content.items.map(({ icon: ItemIcon, title, detail }) => <article className="page-endcap-item" key={title}>
                <span className="page-endcap-item-icon"><ItemIcon size={17} aria-hidden="true"/></span>
                <div><h3>{title}</h3><p>{detail}</p></div>
            </article>)}
        </div>
    </section>;
}

// Licensed food photography is served from Pexels/Unsplash; the in-repo vector art remains a resilient fallback.
const PIZZA_CARD_PHOTOS = {
  mushroom: {
    src: 'https://images.pexels.com/photos/4394619/pexels-photo-4394619.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Freshly baked mushroom pizza with herbs',
  },
  spicy: {
    src: 'https://images.pexels.com/photos/36295120/pexels-photo-36295120.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetarian pizza with olives and bell peppers',
  },
  pestoForest: {
    src: 'https://images.pexels.com/photos/5639971/pexels-photo-5639971.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetarian pizza with mushrooms, olives and artichokes',
  },
  roastedGarden: {
    src: 'https://images.pexels.com/photos/35290483/pexels-photo-35290483.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetarian pizza topped with bell peppers, onion and mushrooms',
  },
  cornfire: {
    src: 'https://images.pexels.com/photos/34382326/pexels-photo-34382326.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Freshly baked vegetable pizza with olives and peppers',
  },
  oliveAtelier: {
    src: 'https://images.pexels.com/photos/26341212/pexels-photo-26341212.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Vegetable and mushroom pizza on a green background',
  },
  classic: {
    src: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?auto=format&fit=crop&w=1280&q=85',
    alt: 'Freshly baked pizza with tomato, cheese and basil',
  },
  rustic: {
    src: 'https://images.pexels.com/photos/31450870/pexels-photo-31450870.jpeg?auto=compress&cs=tinysrgb&w=1280',
    alt: 'Rustic pizza finished with fresh basil',
  },
};

function getPizzaCardIngredientLabels(pizza, catalog) {
  const recipe = pizza?.ingredients;
  if (Array.isArray(recipe)) {
    return recipe.map((item) => typeof item === 'string' ? item : item?.name || item?.label || item?.title || '').filter(Boolean);
  }
  if (!recipe || typeof recipe !== 'object') return [];

  const optionName = (group, id) => catalog?.[group]?.find((item) => item.id === id)?.name || '';
  return [
    optionName('bases', recipe.base),
    optionName('sauces', recipe.sauce),
    optionName('cheeses', recipe.cheese),
    ...(Array.isArray(recipe.vegetables) ? recipe.vegetables.map((id) => optionName('vegetables', id)) : []),
  ].filter(Boolean);
}

function getPizzaCardPhoto(pizza, index) {
  const name = String(pizza?.name || '').toLowerCase();

  // Pin the featured recipes first. Broad ingredient matching must not make
  // different named pizzas reuse the same generic tomato-pizza photograph.
  if (name.includes('margherita')) return PIZZA_CARD_PHOTOS.classic;
  if (name.includes('garden party')) return PIZZA_CARD_PHOTOS.rustic;
  if (name.includes('firecracker')) return PIZZA_CARD_PHOTOS.spicy;
  if (name.includes('white garden')) return PIZZA_CARD_PHOTOS.mushroom;
  if (name.includes('pesto forest')) return PIZZA_CARD_PHOTOS.pestoForest;
  if (name.includes('roasted garden')) return PIZZA_CARD_PHOTOS.roastedGarden;
  if (name.includes('cornfire')) return PIZZA_CARD_PHOTOS.cornfire;
  if (name.includes('olive atelier')) return PIZZA_CARD_PHOTOS.oliveAtelier;

  const recipe = pizza?.ingredients;
  const ingredientNames = recipe && typeof recipe === 'object'
    ? Object.entries(recipe).flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])])
        .filter((value) => typeof value === 'string').join(' ')
    : '';
  const searchable = `${name} ${ingredientNames}`;

  if (/(mushroom|fung|pollo|chicken)/.test(searchable)) return PIZZA_CARD_PHOTOS.mushroom;
  if (/(pepperoni|salami|sausage|jalape|chili|chilli|spicy|hot)/.test(searchable)) return PIZZA_CARD_PHOTOS.spicy;
  if (/(tomato|basil)/.test(searchable)) return PIZZA_CARD_PHOTOS.classic;
  if (/(garden|veggie|vegetable|olive|corn|spinach|plant-based)/.test(searchable)) return PIZZA_CARD_PHOTOS.rustic;
  return [PIZZA_CARD_PHOTOS.classic, PIZZA_CARD_PHOTOS.rustic, PIZZA_CARD_PHOTOS.mushroom, PIZZA_CARD_PHOTOS.pepperoni][index % 4];
}


function CartLinePhoto({ item, index = 0 }) {
    const recipe = item?.type === 'custom'
        ? { base: item.base, sauce: item.sauce, cheese: item.cheese, vegetables: item.vegetables }
        : item?.ingredients;
    const photo = getPizzaCardPhoto({ name: item?.name, ingredients: recipe }, index);
    const variant = getPizzaArtworkVariant({ name: item?.name, ingredients: recipe }, index);
    const [photoLoaded, setPhotoLoaded] = useState(false);
    const [photoFailed, setPhotoFailed] = useState(false);

    return <div
        className={`cart-line-art cart-line-art--${variant} ${photoLoaded ? 'has-photo' : ''}`}
        data-cart-line-photo="catalog-photo-v1"
        data-cart-line-photo-name={item?.name || 'Pizza'}
        aria-hidden="true"
    >
        <PizzaArtwork variant={variant} className="cart-line-artwork"/>
        {!photoFailed && <img
            className="cart-line-photo"
            src={photo.src}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setPhotoLoaded(true)}
            onError={() => { setPhotoFailed(true); setPhotoLoaded(false); }}
        />}
    </div>;
}

function PizzaCard({ pizza, index, onAdd, onCustomize, onViewDetails, catalog }) {
  const variant = getPizzaArtworkVariant(pizza, index);
  const [cardQuantity, setCardQuantity] = useState(1);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = getPizzaCardPhoto(pizza, index);
  const ingredients = getPizzaCardIngredientLabels(pizza, catalog);
  const unitPrice = Number(pizza.price);
  const hasPrice = pizza.price !== null && pizza.price !== undefined && pizza.price !== '' && Number.isFinite(unitPrice) && unitPrice >= 0;
  const unavailable = pizza.available === false || !hasPrice;
  const selectedTotal = hasPrice ? currency(unitPrice * cardQuantity) : '—';

  return <article className={`pizza-card ${variant} card-${index} ${photoLoaded ? 'has-photo' : ''}`} data-pizza-card data-pizza-card-version="premium-photo-v1" data-pizza-card-layout="compact-purchase-v2" data-pizza-unit-price={hasPrice ? unitPrice : ''} data-pizza-id={pizza.id}>
    <div className="pizza-card-art">
      <PizzaArtwork variant={variant} className={`pizza-card-artwork pizza-card-artwork--${variant}`} />
      {!photoFailed && <img
        className="pizza-card-photo"
        src={photo.src}
        alt={photo.alt}
        loading={index < 3 ? 'eager' : 'lazy'}
        fetchPriority={index < 3 ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setPhotoLoaded(true)}
        onError={() => { setPhotoFailed(true); setPhotoLoaded(false); }}
      />}
      <span className="pizza-card-photo-scrim" aria-hidden="true"/>
      <button className="pizza-card-open" data-pizza-card-open="photo-hit-area-v1" type="button" onClick={() => onViewDetails?.()} aria-label={`View ${pizza.name} details`}><span className="pizza-card-view-button" aria-hidden="true">View details <ArrowUpRight size={15}/></span></button>
      <span className="pizza-label">{pizza.tag || 'HOUSE FAVOURITE'}</span>
      <span className={`pizza-card-availability ${unavailable ? 'is-unavailable' : 'is-available'}`}>
        <span aria-hidden="true"/> {pizza.available === false ? 'Sold out' : !hasPrice ? 'Price unavailable' : 'Available'}
      </span>
      <span className="pizza-card-number">0{index + 1}</span>
    </div>
    <div className="pizza-card-body">
      <div className="pizza-card-copy">
        <h3><button className="pizza-card-title-button" type="button" onClick={() => onViewDetails?.()}>{pizza.name}</button></h3>
        <p>{pizza.description}</p>
      </div>

      <div className="pizza-card-ingredients" aria-label={`Ingredients for ${pizza.name}`}>
        {ingredients.length ? ingredients.slice(0, 4).map((ingredient, ingredientIndex) =>
          <span className="pizza-ingredient-chip" key={`${pizza.id}-ingredient-${ingredientIndex}`}>{ingredient}</span>
        ) : <span className="pizza-ingredient-chip">House recipe</span>}
        {ingredients.length > 4 && <span className="pizza-ingredient-chip ingredient-more">+{ingredients.length - 4} more</span>}
      </div>

      <div className="pizza-card-selection">
        <div className="pizza-card-quantity-wrap">
          <span className="pizza-card-control-label">QUANTITY</span>
          <div className="pizza-card-quantity" role="group" aria-label={`Quantity for ${pizza.name}`}>
            <button type="button" aria-label={`Decrease ${pizza.name} quantity`} disabled={unavailable || cardQuantity <= 1} onClick={() => setCardQuantity(value => Math.max(1, value - 1))}><Minus size={15}/></button>
            <span aria-live="polite" aria-atomic="true">{cardQuantity}</span>
            <button type="button" aria-label={`Increase ${pizza.name} quantity`} disabled={unavailable || cardQuantity >= 10} onClick={() => setCardQuantity(value => Math.min(10, value + 1))}><Plus size={15}/></button>
          </div>
        </div>
        <div className="pizza-card-total">
          <span className="pizza-card-control-label">TOTAL</span>
          <strong>{selectedTotal}</strong>
          <small>{cardQuantity} {cardQuantity === 1 ? 'pizza' : 'pizzas'}</small>
        </div>
      </div>

      <div className="pizza-card-actions">
        <button className="add-button" type="button" onClick={() => { onAdd?.(cardQuantity); setCardQuantity(1); }} disabled={unavailable} aria-label={unavailable ? (pizza.available === false ? `${pizza.name} sold out` : `${pizza.name} price unavailable`) : `Add ${pizza.name}`}>
          <ShoppingBag size={17}/><span>{pizza.available === false ? 'Sold out' : !hasPrice ? 'Price unavailable' : 'Add to bag'}</span><ArrowUpRight size={15}/>
        </button>
        <button className="customize-link" type="button" onClick={onCustomize}>Customize recipe <ArrowUpRight size={14}/></button>
      </div>

    </div>
  </article>;
}
function PizzaDetailView({ pizza, catalog, index = 0, returnLabel, onBack, onAdd, onCustomize }) {
  const [quantity, setQuantity] = useState(1);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = getPizzaCardPhoto(pizza, index);
  const ingredients = getPizzaCardIngredientLabels(pizza, catalog);
  const unitPrice = Number(pizza.price);
  const hasPrice = pizza.price !== null && pizza.price !== undefined && pizza.price !== '' && Number.isFinite(unitPrice) && unitPrice >= 0;
  const unavailable = pizza.available === false || !hasPrice;
  const subtotal = hasPrice ? currency(unitPrice * quantity) : '—';

  return <section className="pizza-detail-page section-wrap page-section" data-pizza-detail data-pizza-id={pizza.id}>
    <div className="pizza-detail-breadcrumb">
      <button type="button" onClick={onBack}><ArrowRight size={14} className="breadcrumb-back-icon"/>{returnLabel}</button>
      <span aria-hidden="true">/</span><span>{pizza.name}</span>
    </div>
    <div className="pizza-detail-layout">
      <div className={`pizza-detail-media ${photoLoaded ? 'has-photo' : ''}`}>
        <PizzaArtwork variant={getPizzaArtworkVariant(pizza, index)} className="pizza-detail-artwork"/>
        {!photoFailed && <img
          className="pizza-detail-photo"
          src={photo.src}
          alt={photo.alt}
          fetchPriority="high"
          decoding="async"
          onLoad={() => setPhotoLoaded(true)}
          onError={() => { setPhotoFailed(true); setPhotoLoaded(false); }}
        />}
        <span className="pizza-detail-media-scrim" aria-hidden="true"/>
        <span className="pizza-detail-photo-caption"><CheckCircle2 size={14}/> House favourite · Live recipe</span>
        <span className="pizza-detail-number" aria-hidden="true">P.</span>
      </div>
      <div className="pizza-detail-copy">
        <div className="pizza-detail-kicker"><span className="pizza-detail-live-dot"/> LIVE MENU <span className="pizza-detail-kicker-divider">/</span> HOUSE RECIPE</div>
        <h1>{pizza.name}</h1>
        <p className="pizza-detail-description">{pizza.description || 'A house recipe made to order from the current menu.'}</p>
        <div className="pizza-detail-availability"><span className={unavailable ? 'status-dot is-off' : 'status-dot'}/>{pizza.available === false ? 'Currently unavailable' : !hasPrice ? 'Price needs confirmation' : 'Available from the live menu'}</div>

        <section className="pizza-detail-ingredients" aria-labelledby="pizza-detail-ingredients-title">
          <div className="pizza-detail-section-heading"><div><span className="pizza-detail-section-label">THE RECIPE</span><h2 id="pizza-detail-ingredients-title">What goes into it</h2></div><span className="pizza-detail-ingredient-count">{ingredients.length} ingredients</span></div>
          {ingredients.length ? <div className="pizza-detail-ingredient-list">{ingredients.map((ingredient, ingredientIndex) => <span className="pizza-detail-ingredient" key={`${pizza.id}-detail-ingredient-${ingredientIndex}`}><CheckCircle2 size={14}/>{ingredient}</span>)}</div> : <p className="pizza-detail-recipe-note">Recipe ingredients are not available in the current menu response.</p>}
        </section>

        <div className="pizza-detail-order-panel">
          <div className="pizza-detail-price-line">
            <div><span className="pizza-detail-section-label">CURRENT MENU PRICE</span><strong>{hasPrice ? currency(unitPrice) : 'Unavailable'}</strong><small>One house-recipe pizza</small></div>
            <div className="pizza-detail-quantity-wrap"><span className="pizza-detail-section-label">QUANTITY</span><div className="pizza-card-quantity" role="group" aria-label={`Quantity for ${pizza.name}`}>
              <button type="button" aria-label={`Decrease ${pizza.name} quantity`} disabled={unavailable || quantity <= 1} onClick={() => setQuantity(value => Math.max(1, value - 1))}><Minus size={15}/></button>
              <span aria-live="polite" aria-atomic="true">{quantity}</span>
              <button type="button" aria-label={`Increase ${pizza.name} quantity`} disabled={unavailable || quantity >= 10} onClick={() => setQuantity(value => Math.min(10, value + 1))}><Plus size={15}/></button>
            </div></div>
          </div>
          <div className="pizza-detail-subtotal"><span>YOUR SUBTOTAL</span><strong>{subtotal}</strong><small>{quantity} {quantity === 1 ? 'pizza' : 'pizzas'} · delivery calculated at checkout</small></div>
          <button className="pizza-detail-add-button" type="button" disabled={unavailable} onClick={() => onAdd?.(quantity)}><ShoppingBag size={18}/>{pizza.available === false ? 'Currently unavailable' : !hasPrice ? 'Price unavailable' : `Add ${quantity} to bag`}<ArrowUpRight size={17}/></button>
          <button className="pizza-detail-customize-button" type="button" onClick={onCustomize}>Want to change the recipe? <span>Customize it <ArrowUpRight size={14}/></span></button>
        </div>
        <div className="pizza-detail-assurances">
          <span><ShieldCheck size={15}/> Price confirmed before checkout</span>
          <span><ChefHat size={15}/> Recipe from the live menu</span>
        </div>
      </div>
    </div>
    <div className="pizza-detail-next-step"><div><span>NOT QUITE YOUR FLAVOUR?</span><h2>Find another house favourite.</h2><p>Compare the live menu, ingredients and prices before you decide.</p></div><button type="button" className="button button-dark" onClick={onBack}>Back to menu <ArrowRight size={16}/></button></div>
  </section>;
}

function BuilderPhotoPreview({ photo, variant }) {
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [failedSources, setFailedSources] = useState([]);
  // The builder's first-choice photo is ingredient-aware, but external image
  // hosts can fail independently. Try the other distinct food photos before
  // falling back to the in-repo artwork so the summary stays photo-led.
  const photoCandidates = [
    photo,
    PIZZA_CARD_PHOTOS.rustic,
    PIZZA_CARD_PHOTOS.mushroom,
    PIZZA_CARD_PHOTOS.pepperoni,
    PIZZA_CARD_PHOTOS.classic,
  ].filter((candidate, index, list) =>
    candidate && list.findIndex((entry) => entry?.src === candidate.src) === index,
  );
  const activePhoto = photoCandidates.find((candidate) => !failedSources.includes(candidate.src));

  return <div className={`summary-picture summary-picture--${variant} ${photoLoaded ? 'has-photo' : ''}`} data-builder-preview data-builder-preview-source={photo.src} data-builder-preview-photo-source={activePhoto?.src || ''}>
    <PizzaArtwork variant={variant} className="summary-pizza-artwork"/>
    {activePhoto && <img
      className="summary-pizza-photo"
      data-builder-preview-photo
      src={activePhoto.src}
      alt={activePhoto.alt}
      loading="eager"
      fetchPriority="high"
      decoding="async"
      onLoad={() => setPhotoLoaded(true)}
      onError={() => {
        setPhotoLoaded(false);
        setFailedSources((current) => current.includes(activePhoto.src) ? current : [...current, activePhoto.src]);
      }}
    />}
    <span className="summary-badge">VISUAL REFERENCE</span>
    <span className="summary-photo-note">Illustrative food photo · Your selected recipe is listed below</span>
  </div>;
}

function DataUnavailable({ title, message, onRetry }) { return <div className="catalog-state-card data-unavailable" role="alert"><span className="catalog-state-icon"><RefreshCw size={20}/></span><div className="catalog-state-copy"><h3>{title}</h3><p>{message}</p></div><button className="button button-dark" type="button" onClick={onRetry}>Try again <RefreshCw size={15}/></button></div>; }
function InlineDataWarning({ message, onRetry }) {
    return <div className="inline-data-warning" role="alert" aria-live="assertive" aria-atomic="true">
        <span>{message}</span>
        <button type="button" onClick={onRetry}>Retry <RefreshCw size={14} aria-hidden="true"/></button>
    </div>;
}
function DashboardMetricSkeleton() { return <div className="dashboard-metrics dashboard-metrics-loading" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading order summary…</span>{Array.from({ length: 3 }, (_, i) => <div className="dashboard-metric-placeholder" key={i}><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-metric-number"/><span className="skeleton-line skeleton-meta short"/></div>)}</div>; }
function OrderCardSkeleton({ showAction = false }) { return <article className="order-card order-card-skeleton" aria-hidden="true"><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-order-title"/><span className="skeleton-line skeleton-description"/><div className="skeleton-order-bottom"><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-status"/></div>{showAction && <div className="order-repeat-actions order-repeat-skeleton"><span className="skeleton-line skeleton-repeat-copy"/><span className="skeleton-line skeleton-repeat-action"/></div>}</article>; }
function OrderListSkeleton({ count = 2 }) { return <div className="orders-list" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading orders…</span>{Array.from({ length: count }, (_, i) => <OrderCardSkeleton key={i} showAction/>)}</div>; }
function AdminPanelsSkeleton() {
    return <div className="admin-panels-loading" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading live operations…</span>
        <DashboardAdminMetricSkeleton />
        <div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/>
            <div className="admin-row-skeletons">{Array.from({ length: 5 }, (_, i) => <div className="inventory-row-skeleton" key={i}><span className="skeleton-line"/><span className="skeleton-line"/><span className="skeleton-line"/><span className="skeleton-line"/></div>)}</div>
        </div>
        <div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/>{Array.from({ length: 2 }, (_, i) => <OrderCardSkeleton key={i}/>)}</div>
        <div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/>
            <div className="issue-case-skeletons">{Array.from({ length: 2 }, (_, i) => <div className="issue-case-skeleton" key={i}><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-description"/><span className="skeleton-line skeleton-description short"/></div>)}</div>
        </div>
        <div className="admin-panel"><span className="skeleton-line skeleton-panel-title"/><div className="orders-list">{Array.from({ length: 2 }, (_, i) => <OrderCardSkeleton key={i}/>)}</div></div>
    </div>;
}
function DashboardAdminMetricSkeleton() { return <div className="admin-metrics dashboard-metrics-loading">{Array.from({ length: 4 }, (_, i) => <div className="dashboard-metric-placeholder" key={i}><span className="skeleton-line skeleton-meta"/><span className="skeleton-line skeleton-metric-number"/><span className="skeleton-line skeleton-meta short"/></div>)}</div>; }
function PizzaCardSkeleton() { return <article className="pizza-card pizza-card-skeleton" aria-hidden="true"><div className="skeleton-art"/><div className="pizza-card-body skeleton-card-body"><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><span className="skeleton-line skeleton-description short"/><div className="skeleton-card-bottom"><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-action"/></div><span className="skeleton-line skeleton-link"/></div></article>; }
function PizzaGridSkeleton({ count = 3, full = false }) { return <div className={`pizza-grid ${full ? 'full-grid' : ''}`} role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading pizza choices…</span>{Array.from({ length: count }, (_, i) => <PizzaCardSkeleton key={i}/>)}</div>; }
function CatalogUnavailable({ onRetry, message }) { return <div className="catalog-state-card" role="alert"><span className="catalog-state-icon"><RefreshCw size={20}/></span><div className="catalog-state-copy"><h3>We can’t confirm the live menu right now.</h3><p>{message || 'Prices and availability are not confirmed yet. Please retry before choosing.'}</p></div><button className="button button-dark" type="button" onClick={onRetry}>Try again <RefreshCw size={15}/></button></div>; }
function CatalogEmpty({ onRetry, emptyFilter = false }) { return <div className="catalog-state-card catalog-empty-state" role="status"><span className="catalog-state-icon"><ShoppingBag size={20}/></span><div className="catalog-state-copy"><h3>{emptyFilter ? 'No pizzas match this filter.' : 'No pizzas are available right now.'}</h3><p>{emptyFilter ? 'Choose another flavour filter to see more options.' : 'The current menu did not return any pizzas. Check again shortly.'}</p></div><button className="button button-light" type="button" onClick={onRetry}>{emptyFilter ? 'Clear filter' : 'Refresh menu'} <RefreshCw size={15}/></button></div>; }
function BuilderSkeleton() { return <div className="builder-layout builder-loading" role="status" aria-live="polite" aria-busy="true"><span className="sr-only">Loading pizza ingredients…</span><div className="builder-loading-options">{Array.from({ length: 4 }, (_, i) => <div className="builder-loading-group" key={i}><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><div>{Array.from({ length: i === 3 ? 5 : 3 }, (_, j) => <span className="skeleton-line skeleton-option" key={j}/>)}</div></div>)}</div><aside className="builder-loading-summary"><span className="skeleton-line skeleton-summary-picture"/><span className="skeleton-line skeleton-title"/><span className="skeleton-line skeleton-description"/><span className="skeleton-line skeleton-price"/><span className="skeleton-line skeleton-action"/></aside></div>; }

function BuilderGroup({ step, title, subtitle, options, value, onChange }) { return <div className="builder-group"><div className="builder-step"><span>{step}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="option-list">{options.map(option => <button key={option.id} disabled={option.available === false} aria-pressed={value === option.id} className={`builder-option ${value === option.id ? 'chosen' : ''}`} onClick={() => onChange(option.id)}><span className="radio-dot"/><span>{option.name}</span><small>{option.price === 0 ? 'Included' : `+${currency(option.price)}`}</small></button>)}</div></div>; }
function Ingredient({ label, value }) { return <div className="ingredient-row"><span>{label}</span><b>{value || 'Not selected'}</b></div>; }
function formatOrderStageTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function orderRecipeSummary(item, catalog) {
    const recipe = item?.ingredients;
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return 'Recipe details unavailable';
    const optionName = (group, id) => {
        if (!id) return '';
        return catalog?.[group]?.find(option => option.id === id)?.name || String(id).replaceAll('-', ' ');
    };
    return [
        optionName('bases', recipe.base),
        optionName('sauces', recipe.sauce),
        optionName('cheeses', recipe.cheese),
        ...(Array.isArray(recipe.vegetables) ? recipe.vegetables.map(id => optionName('vegetables', id)) : []),
    ].filter(Boolean).join(' · ') || 'Recipe details unavailable';
}
function OrderStaffAssignment({ order, staff = [], pending = false, onSave }) {
    const [kitchenStaffId, setKitchenStaffId] = useState(order.kitchenStaff?.id || order.kitchenStaff?._id || '');
    const [deliveryStaffId, setDeliveryStaffId] = useState(order.deliveryStaff?.id || order.deliveryStaff?._id || '');
    useEffect(() => {
        setKitchenStaffId(order.kitchenStaff?.id || order.kitchenStaff?._id || '');
        setDeliveryStaffId(order.deliveryStaff?.id || order.deliveryStaff?._id || '');
    }, [order.kitchenStaff?.id, order.deliveryStaff?.id]);
    const activeOptions = (role) => {
        const list = staff.filter(person => person.role === role && person.active);
        const currentId = role === 'kitchen' ? kitchenStaffId : deliveryStaffId;
        const current = staff.find(person => person.id === currentId);
        if (current && !list.some(person => person.id === current.id)) list.unshift(current);
        return list;
    };
    const currentKitchenId = order.kitchenStaff?.id || order.kitchenStaff?._id || '';
    const currentDeliveryId = order.deliveryStaff?.id || order.deliveryStaff?._id || '';
    const dirty = kitchenStaffId !== currentKitchenId || deliveryStaffId !== currentDeliveryId;
    if (!['order_received', 'in_kitchen', 'sent_to_delivery'].includes(order.status)) return null;
    return <div className="order-assignment-panel">
        <div className="order-assignment-heading"><strong>Order ownership</strong><small>Assign an active person before the next hand-off.</small></div>
        <div className="order-assignment-fields">
            <label><span>Kitchen owner</span><select value={kitchenStaffId} disabled={pending || !['order_received', 'in_kitchen'].includes(order.status)} onChange={event => setKitchenStaffId(event.target.value)} aria-label={'Kitchen owner for ' + order.orderNumber}>
                <option value="">Unassigned</option>{activeOptions('kitchen').map(person => <option key={person.id} value={person.id} disabled={!person.active}>{person.name}{person.active ? '' : ' · disabled'}</option>)}
            </select></label>
            <label><span>Delivery partner</span><select value={deliveryStaffId} disabled={pending} onChange={event => setDeliveryStaffId(event.target.value)} aria-label={'Delivery partner for ' + order.orderNumber}>
                <option value="">Unassigned</option>{activeOptions('delivery').map(person => <option key={person.id} value={person.id} disabled={!person.active}>{person.name}{person.active ? '' : ' · disabled'}</option>)}
            </select></label>
        </div>
        <button type="button" className="button button-light small-button" disabled={!dirty || pending} onClick={() => onSave(order, { ...(kitchenStaffId !== currentKitchenId ? { kitchenStaffId: kitchenStaffId || null } : {}), ...(deliveryStaffId !== currentDeliveryId ? { deliveryStaffId: deliveryStaffId || null } : {}) })}>{pending ? 'Saving assignments…' : 'Save assignments'}</button>
    </div>;
}

function StaffManagement({ staff = [], onRefresh, onNotify }) {
    const [form, setForm] = useState({ name: '', email: '', role: 'kitchen' });
    const [saving, setSaving] = useState(false);
    const [pendingId, setPendingId] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const create = async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
            const result = await api('/admin/staff', { method: 'POST', body: form });
            setForm({ name: '', email: '', role: 'kitchen' });
            setShowCreate(false);
            onNotify(result.invitationSent
                ? 'The email provider accepted a one-time setup link for ' + result.staff.email + '. Ask them to check inbox and spam; the link expires in 24 hours.'
                : 'Staff account created. Ask the team member to change their initial password before using the queue.');
            await onRefresh();
        } catch (error) {
            onNotify(error.message || 'Staff account could not be created.', 'error');
        } finally {
            setSaving(false);
        }
    };
    const sendInvitation = async person => {
        if (pendingId) return;
        setPendingId(person.id);
        try {
            const result = await api('/admin/staff/' + person.id + '/invitation', { method: 'POST', body: {} });
            onNotify(result.message || 'The email provider accepted a fresh setup link for ' + person.email + '. Ask them to check inbox and spam.');
            await onRefresh();
        } catch (error) {
            onNotify(error.message || 'The staff setup link could not be sent.', 'error');
        } finally {
            setPendingId(null);
        }
    };
    const setActive = async person => {
        const active = !person.active;
        if (!window.confirm(active
            ? 'Re-enable ' + person.name + '\'s ' + person.role + ' access?'
            : 'Disable ' + person.name + '\'s access now? Their current session will be revoked; any assigned orders will need reassignment.')) return;
        setPendingId(person.id);
        try {
            await api('/admin/staff/' + person.id + '/active', { method: 'PATCH', body: { active } });
            onNotify(person.name + '\'s account ' + (active ? 'enabled' : 'disabled') + '.');
            await onRefresh();
        } catch (error) {
            onNotify(error.message || 'Staff access could not be updated.', 'error');
        } finally {
            setPendingId(null);
        }
    };
    return <div className="staff-management">
        <div className="staff-management-top"><div><strong>{staff.filter(person => person.active).length} active team members</strong><p>Kitchen and delivery access are separate from customer accounts and admin access.</p></div><button type="button" className="button button-dark small-button" onClick={() => setShowCreate(value => !value)}>{showCreate ? 'Close form' : 'Add team member'} <ArrowUpRight size={14}/></button></div>
        {showCreate && <form className="staff-create-form" onSubmit={create}>
            <label>Full name<input required minLength={2} maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Team member name"/></label>
            <label>Work email<input required type="email" autoComplete="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="name@yourbusiness.com"/></label>
            <label>Access role<select value={form.role} onChange={event => setForm(current => ({ ...current, role: event.target.value }))}><option value="kitchen">Kitchen staff</option><option value="delivery">Delivery staff</option></select></label>
            <p className="staff-create-note">We’ll email a one-time setup link to this address. The team member chooses their own password; the link expires after 24 hours. Email delivery must be configured in Render.</p>
            <button type="submit" className="button button-dark" disabled={saving}>{saving ? 'Sending setup link…' : 'Create account & invite'} <Mail size={15}/></button>
        </form>}
        <div className="staff-roster">
            {staff.length ? staff.map(person => <article className={'staff-roster-row ' + (!person.active ? 'is-disabled' : '')} key={person.id}>
                <span className={'staff-role-icon ' + person.role}>{person.role === 'kitchen' ? <ChefHat size={17}/> : <Truck size={17}/>}</span>
                <div className="staff-roster-identity"><strong>{person.name}</strong><small>{person.email}</small>{person.mustChangePassword && <small className="staff-invitation-note">{person.invitationStatus === 'pending' ? 'Setup link sent · expires ' + (person.invitationExpiresAt ? new Date(person.invitationExpiresAt).toLocaleDateString() : 'in 24 hours') : 'Password setup not finished'}</small>}</div>
                <span className={'staff-access-state ' + (!person.active ? 'inactive' : person.invitationStatus === 'pending' ? 'pending' : person.invitationStatus === 'setup_required' ? 'inactive' : 'active')}>{!person.active ? 'Disabled' : person.invitationStatus === 'pending' ? 'Invite sent' : person.invitationStatus === 'setup_required' ? 'Setup needed' : 'Ready'}</span>
                {person.active && person.mustChangePassword && <button type="button" className="button button-light small-button" disabled={pendingId === person.id} onClick={() => sendInvitation(person)}>{pendingId === person.id ? 'Sending…' : person.invitationStatus === 'pending' ? 'Resend link' : 'Send setup link'}</button>}
                <button type="button" className="button button-light small-button" disabled={pendingId === person.id} onClick={() => setActive(person)}>{pendingId === person.id ? 'Saving…' : person.active ? 'Disable' : 'Enable'}</button>
            </article>) : <div className="staff-roster-empty"><strong>No kitchen or delivery accounts yet.</strong><p>Add a named staff account to start assigning paid orders.</p></div>}
        </div>
    </div>;
}

function StaffPasswordChangeForm({ onComplete }) {
    const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const submit = async event => {
        event.preventDefault();
        if (saving) return;
        setError('');
        if (form.newPassword !== form.confirmPassword) {
            setError('The new passwords do not match.');
            return;
        }
        if (form.newPassword === form.currentPassword) {
            setError('Choose a new password different from your temporary password.');
            return;
        }
        setSaving(true);
        try {
            const result = await api('/auth/staff/change-password', {
                method: 'POST',
                body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
            });
            setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            await onComplete(result.user);
        } catch (requestError) {
            setError(requestError.message || 'The password could not be updated.');
        } finally {
            setSaving(false);
        }
    };
    return <div className="staff-password-gate">
        <div className="staff-password-mark"><ShieldCheck size={22}/></div>
        <span className="eyebrow">FIRST SIGN-IN SECURITY</span>
        <h2>Set your private password.</h2>
        <p>This team account was created by your administrator. Change the temporary password before opening any customer or operational information.</p>
        <form className="staff-password-form" onSubmit={submit}>
            <label>Temporary password<input type="password" autoComplete="current-password" required minLength={1} value={form.currentPassword} onChange={event => setForm(value => ({ ...value, currentPassword: event.target.value }))}/></label>
            <label>New password<input type="password" autoComplete="new-password" required minLength={10} value={form.newPassword} onChange={event => setForm(value => ({ ...value, newPassword: event.target.value }))} placeholder="10+ characters, upper/lowercase and number"/></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={10} value={form.confirmPassword} onChange={event => setForm(value => ({ ...value, confirmPassword: event.target.value }))}/></label>
            {error && <p className="staff-password-error" role="alert">{error}</p>}
            <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Securing your account…' : 'Set password & open queue'} <ArrowRight size={16}/></button>
        </form>
        <small>Your current session will be refreshed automatically after the password is saved.</small>
    </div>;
}


function OrderCardItemPreview({ item, index, catalog = DEFAULT_CATALOG }) {
    const quantity = Math.max(0, Number(item?.quantity) || 0);
    const lineTotal = item?.lineTotal ?? (Number(item?.unitPrice) || 0) * quantity;
    const photo = getPizzaCardPhoto(item, index);
    const variant = getPizzaArtworkVariant(item, index);
    const recipeSummary = orderRecipeSummary(item, catalog);
    const [photoLoaded, setPhotoLoaded] = useState(false);
    const [photoFailed, setPhotoFailed] = useState(false);

    return <div className="order-card-item" data-order-card-item data-order-card-item-name={item?.name || 'Pizza'} role="group" aria-label={`${quantity} × ${item?.name || 'Pizza'}`}>
        <div className={`order-card-item-photo order-card-item-photo--${variant} ${photoLoaded ? 'has-photo' : ''}`} aria-hidden="true">
            <PizzaArtwork variant={variant} className="order-card-item-artwork"/>
            {!photoFailed && <img
                src={photo.src}
                alt=""
                loading="lazy"
                decoding="async"
                onLoad={() => setPhotoLoaded(true)}
                onError={() => { setPhotoFailed(true); setPhotoLoaded(false); }}
            />}
            <span className="order-card-item-quantity">{quantity}×</span>
        </div>
        <div className="order-card-item-copy">
            <strong>{item?.name || 'Pizza'}</strong>
            <small>{recipeSummary}</small>
        </div>
        <b className="order-card-item-total">{currency(lineTotal)}</b>
    </div>;
}

function OrderCard({ order, admin = false, staffRole = null, staff = [], onStatus, onAssign, onConfirmDelivery, statusPending = false, assignmentPending = false, onReorder, onResumePayment, pending = false, issue, onReportIssue, onRefreshIssues, catalog = DEFAULT_CATALOG }) {
    const customerView = !admin && !staffRole;
    const orderItems = Array.isArray(order.items) ? order.items : [];
    const current = ORDER_STEPS.findIndex(s => s.id === order.status);
    const paid = order.paymentStatus === 'paid';
    const refunded = order.paymentStatus === 'refunded';
    const cancelled = order.status === 'cancelled';
    const reviewNeeded = Boolean(order.paymentReviewRequired) || order.status === 'payment_review';
    const simulated = (order.paymentMode || 'test') === 'test';
    const next = order.status === 'order_received' ? 'in_kitchen'
        : order.status === 'in_kitchen' ? 'sent_to_delivery'
            : order.status === 'sent_to_delivery' ? 'delivered' : null;
    const nextAction = {
        in_kitchen: 'Accept & start preparation',
        sent_to_delivery: 'Mark prepared & hand to delivery',
        delivered: staffRole === 'delivery' ? 'Request customer confirmation' : 'Customer confirmation required',
    }[next] || '';
    const stageTimes = {
        order_received: order.paidAt || order.createdAt,
        in_kitchen: order.kitchenStartedAt,
        sent_to_delivery: order.dispatchedAt,
        delivered: order.deliveredAt,
    };
    const canRepeat = customerView && !reviewNeeded && ['delivered', 'cancelled'].includes(order.status) &&
        Array.isArray(order.items) && order.items.length > 0;
    const canResumePayment = customerView && !reviewNeeded && order.status === 'pending_payment' && order.paymentStatus === 'pending' &&
        typeof onResumePayment === 'function' && Boolean(order.id);
    const canReportFoodIssue = customerView && paid && !reviewNeeded && !refunded &&
        ['order_received', 'in_kitchen', 'sent_to_delivery', 'delivered'].includes(order.status);
    const canReportPaymentIssue = customerView && (
        reviewNeeded || order.paymentStatus === 'failed' || refunded ||
        (cancelled && paid)
    );
    const canReportIssue = canReportFoodIssue || canReportPaymentIssue;
    const paymentOnlyIssue = reviewNeeded || cancelled || refunded || order.paymentStatus === 'failed';
    const hasDeliveryStaff = Boolean(order.deliveryStaff?.id || order.deliveryStaff?._id);
    const canKitchenAdvance = staffRole === 'kitchen' &&
        (order.status === 'order_received' || (order.status === 'in_kitchen' && hasDeliveryStaff));
    const canDeliveryAdvance = staffRole === 'delivery' && order.status === 'sent_to_delivery' && !order.deliveryConfirmationRequestedAt;
    const activeKitchenAssigned = Boolean(order.kitchenStaff?.id || order.kitchenStaff?._id) && order.kitchenStaff?.active !== false;
    const activeDeliveryAssigned = Boolean(order.deliveryStaff?.id || order.deliveryStaff?._id) && order.deliveryStaff?.active !== false;
    const canAdvance = (admin && next !== 'delivered' && (next === 'in_kitchen' ? activeKitchenAssigned : next === 'sent_to_delivery' ? activeDeliveryAssigned : false)) || canKitchenAdvance || canDeliveryAdvance;

    return <article className="order-card" data-order-id={order.id} data-order-payment-mode={simulated ? 'test' : 'live'} tabIndex={-1}>
        <div className="order-card-top">
            <div className="order-card-identity">
                <span className="eyebrow">ORDER {order.orderNumber}</span>
                <h3>{orderItems.length === 1 ? orderItems[0].name : orderItems.length > 1 ? `${orderItems.length} items in this order` : 'Pizza order'}</h3>
                <p className="order-card-meta">{admin && order.user ? order.user.name + ' · ' + order.user.email : customerView ? formatOrderStageTime(order.createdAt) : 'Assigned to your staff account'} <span aria-hidden="true">·</span> <strong>{currency(order.total)}</strong></p>
                {order.deliveryDetails && <div className="order-delivery-details">
                    <small><strong>Deliver to:</strong> {order.deliveryDetails.recipientName} · {order.deliveryDetails.addressLine}, {order.deliveryDetails.city}, {order.deliveryDetails.state} {order.deliveryDetails.postalCode}</small>
                    <small><strong>Mobile:</strong> {admin || staffRole === 'delivery' ? <a href={'tel:' + order.deliveryDetails.phone}>{order.deliveryDetails.phone}</a> : order.deliveryDetails.phone}</small>
                    {order.deliveryDetails.landmark && <small><strong>Landmark:</strong> {order.deliveryDetails.landmark}</small>}
                    {order.deliveryDetails.instructions && <small><strong>Delivery note:</strong> {order.deliveryDetails.instructions}</small>}
                </div>}
            </div>
            <div className="order-card-badges">
                <span className={'status-pill ' + (reviewNeeded ? 'review' : refunded ? 'refunded' : cancelled ? 'cancelled' : paid ? 'paid' : 'waiting')}>
                    {reviewNeeded ? 'Review required' : refunded ? 'Refunded' : cancelled ? 'Cancelled' : paid ? 'Paid' : 'Payment pending'}
                </span>
                {simulated && <span className="fulfillment-mode-pill">TEST MODE · SANDBOX</span>}
            </div>
        </div>
        {orderItems.length > 0 && <div className="order-card-items" data-order-card-items="catalog-photo-v1" aria-label="Items in this order">
            {orderItems.map((item, index) => <OrderCardItemPreview key={String(item.name || 'pizza') + '-' + index} item={item} index={index} catalog={catalog}/>)}
        </div>}
        {reviewNeeded
            ? <div className="payment-review-warning" role="alert"><strong>Payment captured — order on hold.</strong><p>This order needs a manual payment and inventory review before kitchen preparation or delivery.</p>{admin && order.paymentReviewReason && <small>Reason: {order.paymentReviewReason.replaceAll('_', ' ')}</small>}</div>
            : refunded
                ? <div className="pending-message"><ShieldCheck size={15}/> Full refund confirmed; order cancelled.</div>
                : cancelled
                    ? <div className="pending-message"><X size={15}/> This order was cancelled. Start a new checkout to order again.</div>
                    : paid
                        ? <div className="order-timeline">{ORDER_STEPS.map((step, i) => {
                            const stageTime = i <= current ? stageTimes[step.id] : null;
                            return <div key={step.id} className={'timeline-step ' + (i <= current ? 'complete' : '') + (i === current ? ' current' : '')}>
                                <span className="timeline-icon"><step.icon size={16}/></span>
                                <small>{step.label}</small>
                                {stageTime && <time dateTime={new Date(stageTime).toISOString()}>{formatOrderStageTime(stageTime)}</time>}
                            </div>;
                        })}</div>
                        : <div className="pending-message"><Clock3 size={15}/> Waiting for a verified payment before kitchen preparation.</div>}
        {customerView && paid && order.status === 'sent_to_delivery' && order.deliveryConfirmationRequestedAt && !reviewNeeded && !refunded && !cancelled && <div className="delivery-confirmation-card" data-delivery-confirmation="requested">
            <div><strong>Has your order arrived?</strong><p>Your delivery partner requested receipt confirmation. Confirm only if you have received the order.</p><small>Request recorded {formatOrderStageTime(order.deliveryConfirmationRequestedAt)}.</small></div>
            <button type="button" className="button button-dark small-button" disabled={statusPending} onClick={() => onConfirmDelivery?.(order)}>{statusPending ? 'Saving confirmation…' : 'I received my order'}</button>
        </div>}
        {customerView && paid && simulated && !reviewNeeded && !refunded && !cancelled && <div className="test-order-notice" role="note">
            <strong>TEST MODE · SIMULATED TRACKING</strong>
            <p>Status updates verify the app only. No real kitchen or delivery partner has been contacted for this order.</p>
        </div>}
        {(admin || staffRole) && <div className="order-prep-ticket">
            <div className="order-prep-ticket-heading"><span>PREPARATION TICKET</span><span>{order.items?.length || 0} line items</span></div>
            {order.items?.map((item, index) => <div className="order-prep-line" key={String(item.name) + '-' + index}>
                <div><strong>{item.quantity}× {item.name}</strong><small>{orderRecipeSummary(item, catalog)}</small></div>
                <b>{currency(item.lineTotal ?? item.unitPrice * item.quantity)}</b>
            </div>)}
            {order.deliveryDetails?.instructions && <p className="order-prep-delivery-note"><strong>Delivery note:</strong> {order.deliveryDetails.instructions}</p>}
        </div>}
        {admin && paid && !reviewNeeded && !refunded && !['delivered', 'cancelled'].includes(order.status) &&
            <OrderStaffAssignment order={order} staff={staff} pending={assignmentPending} onSave={onAssign}/>}
        {customerView && issue && <div className={'issue-status-card issue-status-' + issue.status} tabIndex={-1}>
            <div className="issue-status-copy">
                <span className="eyebrow">CASE {issue.reference}</span>
                <strong>{issue.status === 'resolved' ? 'Marked resolved' : issue.status === 'under_review' ? 'Team is reviewing this case' : 'Report received'}</strong>
                <p>{issue.status === 'resolved' ? 'This case has been marked resolved.' : issue.status === 'under_review' ? 'Your report is under review. Check back for the latest update.' : 'Your report is saved and awaiting review.'}</p>
                {issue.customerUpdate && <div className="issue-customer-update"><b>Message from Pizza House</b><p>{issue.customerUpdate}</p></div>}
            </div>
            <button type="button" className="text-link issue-refresh" onClick={() => onRefreshIssues?.()}><RefreshCw size={14}/> Refresh case</button>
        </div>}
        {canReportIssue && (!issue || issue.status === 'resolved') && <div className="order-issue-actions">
            <p>{issue?.status === 'resolved'
                ? 'A new issue with this order? Open another case.'
                : paymentOnlyIssue
                    ? 'Need help with a failed payment, refund, or payment review? Open a support case.'
                    : 'Missing, incorrect, damaged, delayed—or a payment concern? Tell us what happened.'}</p>
            <button type="button" className="button button-light small-button" onClick={event => onReportIssue?.(order, event.currentTarget)}><MessageCircle size={16}/>{issue?.status === 'resolved' ? 'Report another problem' : paymentOnlyIssue ? 'Get payment support' : 'Report a problem'}</button>
        </div>}
        {canAdvance && next && paid && !reviewNeeded && <div className="order-admin-actions">
            <div><span>{admin ? 'Next operational step' : staffRole === 'kitchen' ? 'Kitchen action' : 'Delivery action'}</span><small>{simulated ? 'Sandbox only · no physical dispatch' : 'Verified Live Mode order'}</small></div>
            <button type="button" className="button button-light small-button" disabled={statusPending || (staffRole === 'kitchen' && order.status === 'in_kitchen' && !hasDeliveryStaff)} onClick={() => onStatus(order, next)}>
                {statusPending ? 'Saving status…' : admin && simulated ? 'Simulate: ' + nextAction : nextAction}
                {!statusPending && <ArrowRight size={15}/>}
            </button>
        </div>}
        {staffRole === 'kitchen' && order.status === 'in_kitchen' && !hasDeliveryStaff && <p className="fulfillment-waiting-note">A delivery partner must be assigned before this order can be handed off.</p>}
        {staffRole === 'delivery' && order.status === 'in_kitchen' && <p className="fulfillment-waiting-note">Waiting for the kitchen to hand off this order. The delivery action becomes available after dispatch.</p>}
        {staffRole === 'delivery' && order.status === 'sent_to_delivery' && order.deliveryConfirmationRequestedAt && <p className="fulfillment-waiting-note">Customer confirmation requested at {formatOrderStageTime(order.deliveryConfirmationRequestedAt)}. The order stays on the way until the customer confirms receipt.</p>}
        {admin && order.status === 'sent_to_delivery' && <p className="fulfillment-waiting-note">{order.deliveryConfirmationRequestedAt ? 'Customer confirmation has been requested. Only the customer can mark this order delivered.' : 'The assigned delivery partner must request customer receipt confirmation. Admin cannot mark delivery complete on the customer’s behalf.'}</p>}
        {canResumePayment && <div className="order-repeat-actions order-resume-payment"><p>This order is still unpaid. Resume the saved server quote; no new order is created.</p><button type="button" className="button button-dark small-button" disabled={pending} onClick={() => onResumePayment(order)}><CreditCard size={16}/> Resume checkout</button></div>}
        {canRepeat && <div className="order-repeat-actions"><p>Want this one again? We’ll use the current menu and prices, not the old total.</p><button type="button" className="button button-light small-button" onClick={() => onReorder?.(order)}><RefreshCw size={16}/> Order again</button></div>}
    </article>;
}

function FulfillmentQueue({ orders = [], staff = [], role = 'admin', paymentMode = 'test', catalog = DEFAULT_CATALOG, onStatus, onAssign, pendingStatusOrderId, pendingAssignmentOrderId }) {
    const [filter, setFilter] = useState('active');
    const selectedMode = paymentMode === 'live' ? 'live' : 'test';
    const modeOrders = orders.filter(order => (order.paymentMode || 'test') === selectedMode);
    const eligibleOrders = modeOrders.filter(order =>
        order.paymentStatus === 'paid' &&
        !order.paymentReviewRequired &&
        order.status !== 'payment_review' &&
        order.status !== 'cancelled' &&
        ORDER_STEPS.some(step => step.id === order.status),
    );
    const counts = Object.fromEntries(ORDER_STEPS.map(step => [step.id, eligibleOrders.filter(order => order.status === step.id).length]));
    const options = role === 'delivery' ? [
        { id: 'active', label: 'My run sheet', count: eligibleOrders.filter(order => ['in_kitchen', 'sent_to_delivery'].includes(order.status)).length },
        { id: 'in_kitchen', label: 'Awaiting hand-off', count: counts.in_kitchen },
        { id: 'sent_to_delivery', label: 'Out for delivery', count: counts.sent_to_delivery },
        { id: 'delivered', label: 'Completed', count: counts.delivered },
    ] : role === 'kitchen' ? [
        { id: 'active', label: 'Kitchen queue', count: eligibleOrders.length },
        { id: 'order_received', label: 'Needs acceptance', count: counts.order_received },
        { id: 'in_kitchen', label: 'In preparation', count: counts.in_kitchen },
    ] : [
        { id: 'active', label: 'Active queue', count: eligibleOrders.filter(order => order.status !== 'delivered').length },
        { id: 'order_received', label: 'Needs kitchen', count: counts.order_received },
        { id: 'in_kitchen', label: 'In preparation', count: counts.in_kitchen },
        { id: 'sent_to_delivery', label: 'On the way', count: counts.sent_to_delivery },
        { id: 'delivered', label: 'Completed', count: counts.delivered },
    ];
    const visibleOrders = eligibleOrders.filter(order => {
        if (filter !== 'active') return order.status === filter;
        return role === 'admin' ? order.status !== 'delivered' : role === 'delivery' ? ['in_kitchen', 'sent_to_delivery'].includes(order.status) : true;
    }).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const waitingForPayment = role === 'admin' ? modeOrders.filter(order => order.paymentStatus !== 'paid' && !['cancelled', 'payment_review'].includes(order.status)).length : 0;

    return <div className="fulfillment-console">
        <div className={'fulfillment-mode-banner ' + (selectedMode === 'test' ? 'is-simulated' : 'is-live')}>
            <span className="fulfillment-banner-kicker">{selectedMode === 'test' ? 'SANDBOX WORKFLOW' : 'LIVE OPERATIONS'}</span>
            <strong>{selectedMode === 'test' ? 'Test orders · simulated kitchen and delivery' : 'Verified live orders · kitchen and dispatch'}</strong>
            <p>{selectedMode === 'test'
                ? 'Test Mode lets staff validate their assigned stages only. No real kitchen ticket is sent and no driver is contacted.'
                : 'Only paid orders with matching Live Mode can enter real operations. Your queue contains only orders assigned to your staff account.'}</p>
        </div>
        <div className="fulfillment-stage-summary">
            {ORDER_STEPS.map((step, index) => <div className={'fulfillment-stage-count stage-' + index} key={step.id}>
                <span>{String(index + 1).padStart(2, '0')} / {step.label}</span>
                <strong>{counts[step.id]}</strong>
                <small>{step.id === 'order_received' ? 'Awaiting kitchen acceptance' : step.id === 'in_kitchen' ? 'Preparation in progress' : step.id === 'sent_to_delivery' ? 'Out for delivery' : 'Completed orders'}</small>
            </div>)}
        </div>
        <div className="fulfillment-queue-toolbar">
            <div><h3>{role === 'kitchen' ? 'Assigned kitchen orders' : role === 'delivery' ? 'Assigned delivery orders' : 'Fulfillment queue'}</h3><p>{role === 'admin' ? 'Assign each order to named staff before hand-off.' : 'You can only update orders assigned to your own staff account.'}</p></div>
            <div className="fulfillment-filter-row" role="group" aria-label="Filter orders by fulfillment stage">
                {options.map(option => <button type="button" key={option.id} className={'fulfillment-filter ' + (filter === option.id ? 'is-active' : '')} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}<span>{option.count}</span></button>)}
            </div>
        </div>
        {visibleOrders.length
            ? <div className="orders-list fulfillment-order-list">{visibleOrders.map(order => <OrderCard key={order.id} order={order} admin={role === 'admin'} staffRole={['kitchen', 'delivery'].includes(role) ? role : null} staff={staff} catalog={catalog} onStatus={onStatus} onAssign={onAssign} statusPending={pendingStatusOrderId === order.id} assignmentPending={pendingAssignmentOrderId === order.id}/>)}</div>
            : <div className="fulfillment-empty"><span>{filter === 'delivered' ? '✓' : '↗'}</span><strong>{filter === 'delivered' ? 'No completed orders in this queue yet' : filter === 'active' ? 'Your assigned queue is clear' : 'No assigned orders at this stage'}</strong><p>{role === 'admin' ? 'Paid, eligible orders appear here after payment verification.' : 'An administrator must assign an order to your staff account before it appears here.'}</p></div>}
        {waitingForPayment > 0 && <p className="fulfillment-waiting-note">{waitingForPayment} order{waitingForPayment === 1 ? '' : 's'} are waiting for verified payment and are intentionally excluded from kitchen preparation.</p>}
        {orders.some(order => (order.paymentMode || 'test') !== selectedMode) && <p className="fulfillment-waiting-note">Orders from the other payment mode are excluded. Test payments are never promoted into real fulfillment.</p>}
    </div>;
}


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
let razorpayLoadPromise = null;

function loadRazorpay() {
    if (typeof window.Razorpay === 'function') return Promise.resolve();
    if (razorpayLoadPromise) return razorpayLoadPromise;

    const load = new Promise((resolve, reject) => {
        let timeoutId;
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;

        const cleanup = () => {
            if (timeoutId) window.clearTimeout(timeoutId);
            script.onload = null;
            script.onerror = null;
        };
        const fail = (message) => {
            cleanup();
            script.remove();
            reject(new Error(message));
        };

        script.onload = () => {
            if (typeof window.Razorpay !== 'function') {
                fail('Razorpay Checkout downloaded but did not initialize. Refresh the page and try again.');
                return;
            }
            cleanup();
            resolve();
        };
        script.onerror = () => {
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            fail(offline
                ? 'Your device appears to be offline. Reconnect and retry Razorpay Checkout.'
                : 'Your browser could not load Razorpay Checkout from its official host. Check your network, VPN/Private DNS or content blocker; then reopen Pizza House directly in Chrome and retry.');
        };
        timeoutId = window.setTimeout(() => {
            fail('Razorpay Checkout took too long to load. Check your connection or content blocker, then retry.');
        }, 15000);

        document.head.appendChild(script);
    });

    let sharedLoad;
    sharedLoad = load.finally(() => {
        if (razorpayLoadPromise === sharedLoad) razorpayLoadPromise = null;
    });
    razorpayLoadPromise = sharedLoad;
    return sharedLoad;
}

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

function IssueReportDialog({ order, form, setForm, pending, returnFocusRef, onSubmit, onCancel }) {
    const dialogRef = useRef(null);
    const paymentOnly = Boolean(order?.paymentReviewRequired) ||
        order?.status === 'payment_review' || order?.status === 'cancelled' ||
        ['failed', 'refunded'].includes(order?.paymentStatus);
    const availableCategories = Object.entries(ISSUE_CATEGORY_LABELS)
        .filter(([value]) => !paymentOnly || value === 'payment_refund');
    useEffect(() => {
        dialogRef.current?.querySelector('select')?.focus();
        return () => {
            const trigger = returnFocusRef?.current;
            if (trigger?.isConnected) {
                trigger.focus();
                return;
            }
            const card = Array.from(document.querySelectorAll('[data-order-id]'))
                .find(element => element.dataset.orderId === order.id);
            const fallback = card?.querySelector('.issue-status-card') || card;
            fallback?.focus();
        };
    }, []);

    useEffect(() => {
        if (pending && !dialogRef.current?.contains(document.activeElement)) {
            dialogRef.current?.querySelector('select:not(:disabled), textarea:not(:disabled)')?.focus();
        }
    }, [pending]);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            if (!pending) {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }
            return;
        }
        if (event.key !== 'Tab') return;

        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll(
            'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        )).filter(element => element.getClientRects().length > 0);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    };

    return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !pending && onCancel()}>
        <section className="auth-modal issue-report-modal" role="dialog" aria-modal="true" aria-labelledby="issue-report-title" aria-describedby="issue-report-description"
            tabIndex={-1} ref={dialogRef} onKeyDown={handleKeyDown}>
            <IconButton className="modal-close" label="Close dialog" disabled={pending} onClick={onCancel}><X size={19}/></IconButton>
            <div className="auth-brand-mark"><MessageCircle size={21}/></div>
            <div className="eyebrow">ORDER SUPPORT</div>
            <h2 id="issue-report-title">Let’s make this right.</h2>
            <p id="issue-report-description">Tell us what happened with order {order.orderNumber}. We’ll create a reference you can follow from your order history. Payment cases are reviewed by the team; submitting this form does not automatically issue a refund.</p>
            <form onSubmit={onSubmit}>
                <label className="issue-field"><span>What went wrong?</span>
                    <select data-payment-review-support="payment-support-v1" required value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))}>
                        {availableCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </label>
                <label className="issue-field"><span>Tell us what happened</span>
                    <textarea required minLength={10} maxLength={600} rows={4}
                        placeholder={paymentOnly ? 'For example, I need help understanding the payment review or refund status…' : 'For example, one item was missing from the delivery…'}
                        value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))}/>
                </label>
                <div className="issue-form-footnote"><span>{form.description.trim().length}/600 characters</span><span>Please don’t include passwords or payment-card details.</span></div>
                <div className="issue-report-actions">
                    <button type="button" className="button button-light" disabled={pending} onClick={onCancel}>Cancel</button>
                    <button type="submit" className="button button-dark" disabled={pending || form.description.trim().length < 10}>
                        {pending ? <LoaderCircle size={17} className="spin"/> : <MessageCircle size={17}/>}
                        {pending ? 'Submitting case…' : 'Submit report'}
                    </button>
                </div>
            </form>
        </section>
    </div>;
}

function AdminIssueCard({ issue, pending, onUpdate }) {
    const [customerUpdate, setCustomerUpdate] = useState(issue.customerUpdate || '');
    useEffect(() => setCustomerUpdate(issue.customerUpdate || ''), [issue.customerUpdate]);
    const saveMessage = () => onUpdate(issue, { customerUpdate });
    const resolve = () => onUpdate(issue, { status: 'resolved', customerUpdate });
    const review = () => onUpdate(issue, { status: 'under_review', customerUpdate });

    return <article className="issue-case-card">
        <div className="issue-case-head">
            <div><span className="eyebrow">{issue.reference}</span><h3>{ISSUE_CATEGORY_LABELS[issue.category] || 'Customer issue'}</h3></div>
            <span className={`status-pill ${issue.status === 'resolved' ? 'paid' : issue.status === 'under_review' ? 'waiting' : 'review'}`}>{issue.status.replaceAll('_', ' ')}</span>
        </div>
        <p className="issue-case-description">{issue.description}</p>
        <div className="issue-case-meta">
            <span><b>Order:</b> {issue.order?.orderNumber || 'Order unavailable'}</span>
            <span><b>Customer:</b> {issue.user?.name || 'Customer'}{issue.user?.email ? ` · ${issue.user.email}` : ''}</span>
            <span><b>Reported:</b> {issue.createdAt ? new Date(issue.createdAt).toLocaleString() : 'Time unavailable'}</span>
        </div>
        <label className="issue-field issue-customer-update-field"><span>Message for customer</span>
            <textarea rows={2} maxLength={600} value={customerUpdate} onChange={event => setCustomerUpdate(event.target.value)} placeholder="Share an update the customer will see in order history."/>
        </label>
        <small className="issue-note-hint">This message is visible to the customer. Don’t place private internal notes here.</small>
        <div className="issue-admin-actions">
            <button type="button" className="button button-light small-button" disabled={pending} onClick={saveMessage}>{pending ? 'Saving…' : 'Save message'}</button>
            {issue.status === 'open' && <button type="button" className="button button-light small-button" disabled={pending} onClick={review}>Mark in review</button>}
            {issue.status !== 'resolved' && <button type="button" className="button button-dark small-button" disabled={pending} onClick={resolve}>Resolve case</button>}
        </div>
    </article>;
}

function PaymentRetryPanel({ pending, onRetry }) { return <div className="payment-retry-panel" role="alert"><strong>Payment needs confirmation</strong><p>We could not confirm the previous payment yet. Do not open another payment. Retry the server verification for the same payment.</p><button disabled={pending} className="button button-light full-button" onClick={onRetry}>{pending ? <LoaderCircle className="spin" size={17}/> : <RefreshCw size={16}/>} {pending ? 'Checking payment…' : 'Retry payment confirmation'}</button></div>; }
