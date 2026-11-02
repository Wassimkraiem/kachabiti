"use client";

import { use } from "react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Order as OrderType } from "@/lib/orders";
import { getUserFavorites, removeFromFavorites, FavoriteWithProduct } from "@/lib/favorites";
import ProductListCard from "@/components/products/ProductListCard";
import { useQuickAdd } from "@/lib/quick-add";
import { FormInput } from "@/components/forms";
import OrderTracking, { type OrderDelivery } from "@/components/ui/OrderTracking";
import { accountApi, announceAuthChange, authHref, customerName, signOut, useCustomer, type Customer } from "@/lib/customer-auth";

type Locale = "en" | "fr" | "ar";

type OrderItem = {
  id: string;
  order_id: string;
  product_name: string;
  product_image: string;
  quantity: number;
  price: number;
  subtotal: number;
};

type OrderWithItems = OrderType & {
  items: OrderItem[];
  /** Its Colissimo parcel once sent: where it stands (GET /api/account/orders). */
  delivery: OrderDelivery | null;
};

type UserProfile = {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
};

type ProfileFormData = {
  full_name: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  address: string;
};

type PasswordFormData = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const content: Record<Locale, {
  pageTitle: string;
  pageSubtitle: string;
  tabs: { id: string; label: string; }[];
  myOrders: string;
  orderDate: string;
  orderNo: string;
  payment: string;
  shippingAddress: string;
  quantity: string;
  status: string;
  accountInfo: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  saveChanges: string;
  cancel: string;
  security: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  changePassword: string;
  savedItems: string;
  noSavedItems: string;
  removeFromSaved: string;
  noOrders: string;
  logout: string;
  loading: string;
  profileSaved: string;
  passwordChanged: string;
  wrongPassword: string;
  passwordTooShort: string;
  passwordMismatch: string;
  itemRemoved: string;
  somethingWrong: string;
}> = {
  en: {
    pageTitle: "Settings",
    pageSubtitle: "Manage your account settings and preferences",
    tabs: [
      { id: "orders", label: "My Orders" },
      { id: "account", label: "Account Information" },
      { id: "security", label: "Security" },
      { id: "saved", label: "Saved Items" },
      { id: "logout", label: "Log out" }
    ],
    myOrders: "My Orders",
    orderDate: "Order Date",
    orderNo: "Order No",
    payment: "Payment",
    shippingAddress: "Shipping Address",
    quantity: "Quantity",
    status: "Status",
    accountInfo: "Account Information",
    fullName: "Full Name",
    email: "Email Address",
    phone: "Phone Number",
    address: "Address",
    city: "City",
    country: "Country",
    saveChanges: "Save Changes",
    cancel: "Cancel",
    security: "Security Settings",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    changePassword: "Change Password",
    savedItems: "Saved Items",
    noSavedItems: "No saved items yet",
    removeFromSaved: "Remove",
    noOrders: "No orders yet",
    logout: "Log out",
    loading: "Loading…",
    profileSaved: "Your details have been saved.",
    passwordChanged: "Your password has been changed.",
    wrongPassword: "Your current password is incorrect.",
    passwordTooShort: "The new password must be at least 8 characters.",
    passwordMismatch: "The new passwords do not match.",
    itemRemoved: "Removed from saved items.",
    somethingWrong: "Something went wrong. Try again."
  },
  fr: {
    pageTitle: "Paramètres",
    pageSubtitle: "Gérez les paramètres et préférences de votre compte",
    tabs: [
      { id: "orders", label: "Mes commandes" },
      { id: "account", label: "Informations du compte" },
      { id: "security", label: "Sécurité" },
      { id: "saved", label: "Articles enregistrés" },
      { id: "logout", label: "Se déconnecter" }
    ],
    myOrders: "Mes commandes",
    orderDate: "Date de commande",
    orderNo: "N° commande",
    payment: "Paiement",
    shippingAddress: "Adresse de livraison",
    quantity: "Quantité",
    status: "Statut",
    accountInfo: "Informations du compte",
    fullName: "Nom complet",
    email: "Adresse e-mail",
    phone: "Numéro de téléphone",
    address: "Adresse",
    city: "Ville",
    country: "Pays",
    saveChanges: "Enregistrer les modifications",
    cancel: "Annuler",
    security: "Paramètres de sécurité",
    currentPassword: "Mot de passe actuel",
    newPassword: "Nouveau mot de passe",
    confirmPassword: "Confirmer le nouveau mot de passe",
    changePassword: "Changer le mot de passe",
    savedItems: "Articles enregistrés",
    noSavedItems: "Aucun article enregistré",
    removeFromSaved: "Retirer",
    noOrders: "Aucune commande",
    logout: "Se déconnecter",
    loading: "Chargement…",
    profileSaved: "Vos informations ont été enregistrées.",
    passwordChanged: "Votre mot de passe a été modifié.",
    wrongPassword: "Votre mot de passe actuel est incorrect.",
    passwordTooShort: "Le nouveau mot de passe doit contenir au moins 8 caractères.",
    passwordMismatch: "Les nouveaux mots de passe ne correspondent pas.",
    itemRemoved: "Retiré des articles enregistrés.",
    somethingWrong: "Une erreur est survenue. Réessayez."
  },
  ar: {
    pageTitle: "الإعدادات",
    pageSubtitle: "إدارة إعدادات وتفضيلات حسابك",
    tabs: [
      { id: "orders", label: "طلباتي" },
      { id: "account", label: "معلومات الحساب" },
      { id: "security", label: "الأمان" },
      { id: "saved", label: "العناصر المحفوظة" },
      { id: "logout", label: "تسجيل الخروج" }
    ],
    myOrders: "طلباتي",
    orderDate: "تاريخ الطلب",
    orderNo: "رقم الطلب",
    payment: "الدفع",
    shippingAddress: "عنوان الشحن",
    quantity: "الكمية",
    status: "الحالة",
    accountInfo: "معلومات الحساب",
    fullName: "الاسم الكامل",
    email: "عنوان البريد الإلكتروني",
    phone: "رقم الهاتف",
    address: "العنوان",
    city: "المدينة",
    country: "البلد",
    saveChanges: "حفظ التغييرات",
    cancel: "إلغاء",
    security: "إعدادات الأمان",
    currentPassword: "كلمة المرور الحالية",
    newPassword: "كلمة المرور الجديدة",
    confirmPassword: "تأكيد كلمة المرور الجديدة",
    changePassword: "تغيير كلمة المرور",
    savedItems: "العناصر المحفوظة",
    noSavedItems: "لا توجد عناصر محفوظة بعد",
    removeFromSaved: "إزالة",
    noOrders: "لا توجد طلبات بعد",
    logout: "تسجيل الخروج",
    loading: "جاري التحميل…",
    profileSaved: "تم حفظ معلوماتك.",
    passwordChanged: "تم تغيير كلمة المرور.",
    wrongPassword: "كلمة المرور الحالية غير صحيحة.",
    passwordTooShort: "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.",
    passwordMismatch: "كلمتا المرور الجديدتان غير متطابقتين.",
    itemRemoved: "تمت الإزالة من العناصر المحفوظة.",
    somethingWrong: "حدث خطأ. حاول مجدداً."
  }
};

export default function SettingsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale: rawLocale } = use(params);
  const locale: Locale = ["en", "fr", "ar"].includes(rawLocale as string) ? (rawLocale as Locale) : "en";
  const text = content[locale];
  const router = useRouter();
  const quickAdd = useQuickAdd('');
  const { user, loading: authLoading } = useCustomer();
  // Set while logging out, so losing the session sends the customer home rather than to the login page.
  const loggingOut = useRef(false);

  const [activeTab, setActiveTab] = useState("orders");
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [savedItems, setSavedItems] = useState<FavoriteWithProduct[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

  // React Hook Form for profile
  const profileForm = useForm<ProfileFormData>({
    defaultValues: {
      full_name: "",
      email: "",
      phone: "",
      country: "",
      city: "",
      address: "",
    },
  });

  // React Hook Form for password
  const passwordForm = useForm<PasswordFormData>({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Fetch user orders
  const fetchOrders = async () => {
    setOrdersLoading(true);
    try {
      setOrders(await accountApi<OrderWithItems[]>("account/orders"));
    } catch (error) {
      console.error("Error in fetchOrders:", error);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Fetch user favorites
  const fetchFavorites = async (userId: string) => {
    setFavoritesLoading(true);
    try {
      const { favorites, error } = await getUserFavorites(userId);

      if (error) {
        console.error("Error fetching favorites:", error);
      } else {
        setSavedItems(favorites);
      }
    } catch (error) {
      console.error("Error in fetchFavorites:", error);
    } finally {
      setFavoritesLoading(false);
    }
  };

  // Handle remove from favorites
  const handleRemoveFavorite = async (productId: string) => {
    if (!userProfile) return;

    const { success, error } = await removeFromFavorites(userProfile.id, productId);

    if (success) {
      // Remove from local state
      setSavedItems(prev => prev.filter(item => item.product_id !== productId));
      toast.success(text.itemRemoved);
    } else {
      console.error("Error removing favorite:", error);
      toast.error(text.somethingWrong);
    }
  };

  // Account pages need a signed-in customer; load their data once the session is known.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      if (loggingOut.current) return;
      router.replace(authHref(locale, { redirect: `/${locale}/settings`, reason: "account" }));
      return;
    }
    const meta = user.user_metadata || {};
    const profile: UserProfile = {
      id: user.id,
      email: user.email || "",
      full_name: customerName(user),
      phone: meta.phone || "",
      address: meta.address || "",
      city: meta.city || "",
      country: meta.country || "",
    };
    setUserProfile(profile);
    profileForm.reset({
      full_name: profile.full_name || "",
      email: profile.email,
      phone: profile.phone || "",
      country: profile.country || "",
      city: profile.city || "",
      address: profile.address || "",
    });
    fetchOrders();
    fetchFavorites(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const handleTabClick = async (tabId: string) => {
    if (tabId === "logout") {
      loggingOut.current = true;
      await signOut();
      router.replace(`/${locale}`);
      return;
    }
    setActiveTab(tabId);
  };

  // The current password is re-checked before it can be changed.
  const handlePasswordChange = async (data: PasswordFormData) => {
    if (!userProfile) return;
    if (data.newPassword.length < 8) return toast.error(text.passwordTooShort);
    if (data.newPassword !== data.confirmPassword) return toast.error(text.passwordMismatch);

    try {
      await accountApi("auth/password", {
        method: "PUT",
        body: { currentPassword: data.currentPassword, newPassword: data.newPassword },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "invalid_credentials") return toast.error(text.wrongPassword);
      console.error("Error changing password:", error);
      return toast.error(text.somethingWrong);
    }
    passwordForm.reset();
    toast.success(text.passwordChanged);
  };

  // Profile details live in the account's user_metadata; the API also stores the name
  // on the account so reviews show it.
  const handleProfileUpdate = async (data: ProfileFormData) => {
    try {
      const updated = await accountApi<Customer>("auth/profile", {
        method: "PUT",
        body: {
          full_name: data.full_name.trim(),
          phone: data.phone.trim(),
          country: data.country.trim(),
          city: data.city.trim(),
          address: data.address.trim(),
        },
      });
      announceAuthChange(updated);
    } catch (error) {
      console.error("Error updating profile:", error);
      return toast.error(text.somethingWrong);
    }
    toast.success(text.profileSaved);
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-gray-600">
        {text.loading}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-white">

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-semibold text-[#2b1a16]">{text.pageTitle}</h1>
        <p className="text-sm text-gray-600 mt-2">{text.pageSubtitle}</p>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <ul className="space-y-2">
                {text.tabs.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => handleTabClick(t.id)}
                      className={`cursor-pointer w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${activeTab === t.id
                        ? 'bg-[#F6EDEA] text-[#7a3b2e] font-medium'
                        : 'hover:bg-gray-50 text-gray-700'
                        }`}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Content */}
          <section className="lg:col-span-3">
            {/* Orders Tab */}
            {activeTab === "orders" && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 font-medium text-gray-900">
                  {text.myOrders}
                </div>

                {ordersLoading ? (
                  <div className="p-6 text-center text-gray-500">
                    Loading orders...
                  </div>
                ) : orders.length === 0 ? (
                  <div className="p-6">
                    <div className="text-center text-gray-500 py-12">
                      {text.noOrders}
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {orders.map((order) => (
                      <div key={order.id} className="p-6">
                        {/* Order Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="font-medium text-gray-900">
                              {text.orderNo}: {order.order_number}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {text.orderDate}: {new Date(order.created_at).toLocaleDateString(locale)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-[#7a3b2e] text-lg">
                              {order.total.toFixed(2)} TND
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {text.status}: <span className="font-medium">{order.status}</span>
                            </div>
                          </div>
                        </div>

                        <OrderTracking orderStatus={order.status} delivery={order.delivery} locale={locale} />

                        {/* Order Items */}
                        <div className="mt-4 space-y-3">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-4">
                              <div className="relative w-20 h-20 rounded-md overflow-hidden border border-gray-200 shrink-0">
                                <Image
                                  src={item.product_image || "/assets/images/logoKachabity.jpg"}
                                  alt={item.product_name}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">
                                  {item.product_name}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {text.quantity}: {item.quantity} × {item.price.toFixed(2)} TND
                                </div>
                              </div>
                              <div className="font-medium text-gray-900">
                                {item.subtotal.toFixed(2)} TND
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Order Footer */}
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <div className="flex justify-between text-sm">
                            <div>
                              <span className="text-gray-500">{text.shippingAddress}:</span>
                              <span className="ml-2 text-gray-900">
                                {order.shipping_address}, {order.shipping_city}, {order.shipping_country}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">{text.payment}:</span>
                              <span className="ml-2 text-gray-900">{order.payment_status}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Account Information Tab */}
            {activeTab === "account" && userProfile && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 font-medium text-gray-900">
                  {text.accountInfo}
                </div>
                <form onSubmit={profileForm.handleSubmit(handleProfileUpdate)} className="p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      label={text.fullName}
                      name="full_name"
                      type="text"
                      register={profileForm.register}
                      error={profileForm.formState.errors.full_name}
                    />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {text.email}
                      </label>
                      <input
                        type="email"
                        value={userProfile.email}
                        disabled
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed text-black"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      label={text.phone}
                      name="phone"
                      type="tel"
                      register={profileForm.register}
                      error={profileForm.formState.errors.phone}
                    />
                    <FormInput
                      label={text.country}
                      name="country"
                      type="text"
                      register={profileForm.register}
                      error={profileForm.formState.errors.country}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput
                      label={text.city}
                      name="city"
                      type="text"
                      register={profileForm.register}
                      error={profileForm.formState.errors.city}
                    />
                    <FormInput
                      label={text.address}
                      name="address"
                      type="text"
                      register={profileForm.register}
                      error={profileForm.formState.errors.address}
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      className="px-6 py-2 bg-[#7a3b2e] text-white rounded-md hover:bg-[#5e2d23] transition"
                    >
                      {text.saveChanges}
                    </button>
                    <button
                      type="button"
                      className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                    >
                      {text.cancel}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === "security" && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 font-medium text-gray-900">
                  {text.security}
                </div>
                <form onSubmit={passwordForm.handleSubmit(handlePasswordChange)} className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {text.currentPassword}
                    </label>
                    <input
                      type="password"
                      {...passwordForm.register("currentPassword")}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent transition text-black placeholder:text-[#C9C9C9]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {text.newPassword}
                    </label>
                    <input
                      type="password"
                      {...passwordForm.register("newPassword")}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent transition text-black placeholder:text-[#C9C9C9]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {text.confirmPassword}
                    </label>
                    <input
                      type="password"
                      {...passwordForm.register("confirmPassword")}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7a3b2e] focus:border-transparent transition text-black placeholder:text-[#C9C9C9]"
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      className="px-6 py-2 bg-[#7a3b2e] text-white rounded-md hover:bg-[#5e2d23] transition"
                    >
                      {text.changePassword}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Saved Items Tab */}
            {activeTab === "saved" && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 font-medium text-gray-900">
                  {text.savedItems}
                </div>

                {favoritesLoading ? (
                  <div className="p-6 text-center text-gray-500">
                    Loading saved items...
                  </div>
                ) : savedItems.length === 0 ? (
                  <div className="p-6">
                    <div className="text-center text-gray-500 py-12">
                      {text.noSavedItems}
                    </div>
                  </div>
                ) : (
                  <div className="p-6">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-7 pb-4 sm:grid-cols-3 lg:grid-cols-4">
                      {savedItems.map((item) => (
                        <ProductListCard
                          key={item.id}
                          product={{
                            id: item.product.id,
                            name: item.product.name,
                            name_ar: item.product.name_ar,
                            name_fr: item.product.name_fr,
                            slug: item.product.slug,
                            image_url: item.product.image_url || "/assets/images/logoKachabity.jpg",
                            base_price: item.product.base_price ?? item.product.price_cents,
                            currency: item.product.currency,
                            rating: item.product.rating || 0,
                            review_count: item.product.review_count || 0,
                            discount_percent: item.product.discount_percent,
                            product_images: item.product.product_images
                          }}
                          locale={locale}
                          isFavorite={true}
                          onToggleFavorite={() => handleRemoveFavorite(item.product_id)}
                          onAddToCart={(item) => quickAdd(item)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          <div className="absolute  left-[-160px] top-[550px] ">
            <Image src="/assets/images/checkout/backgroundCheckout.svg" alt="bg-checkout" width={100} height={100} className="w-full h-[full] object-cover" />
          </div>
          <div className="absolute top-55 right-0 ">
            <Image src="/assets/images/checkout/bgCheckoutRight.svg" alt="bg-checkout" width={100} height={100} className="w-full h-full object-cover" />
          </div>
        </div>
      </section>
    </main>
  );
}
