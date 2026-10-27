import nodemailer from 'nodemailer';
import type { Order, OrderItem } from './order-types';
import { headerConfig } from './config';

interface EmailData {
    order: Order;
    orderItems: OrderItem[];
    customerName: string;
    /** Reports a failure (Sentry); shared with the NestJS API, so the caller supplies it. */
    onError?: (error: unknown) => void;
}

export async function sendOrderConfirmationEmail(data: EmailData) {
    const { order, orderItems, customerName } = data;

    try {
        // Check if Gmail is configured
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            const errorMsg = 'Gmail credentials are not configured in environment variables';
            console.error(errorMsg);
            data.onError?.(new Error(errorMsg));
            return {
                success: false,
                error: {
                    message: errorMsg,
                    details: 'Please add GMAIL_USER and GMAIL_APP_PASSWORD to your .env.local file'
                }
            };
        }

        const transporter = nodemailer.createTransport({
            ...(process.env.SMTP_HOST
                ? { host: process.env.SMTP_HOST, port: 465, secure: true }
                : { service: 'gmail' }),
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD,
            },
        });

        console.log('Attempting to send email from:', process.env.GMAIL_USER, 'to:', order.customer_email);

        const emailHtml = generateOrderConfirmationHTML(order, orderItems, customerName);

        const emailResult = await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: order.customer_email,
            subject: `Order Confirmation - ${escapeHtml(order.order_number)}`,
            html: emailHtml,
        });

        console.log('Order confirmation email sent successfully:', emailResult.messageId);
        return { success: true, data: emailResult };
    } catch (error: unknown) {
        console.error('Failed to send order confirmation email:', error);
        data.onError?.(error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        const errorDetails = error instanceof Error ? error.stack : String(error);
        return {
            success: false,
            error: {
                message: errorMessage,
                details: errorDetails || 'No error details available'
            }
        };
    }
}

// Escapes text for HTML: names, addresses and phone numbers are typed in by customers.
function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateOrderConfirmationHTML(order: Order, orderItems: OrderItem[], customerName: string): string {
    const logoUrl = process.env.NEXT_PUBLIC_LOGO_URL;
    const itemsHTML = orderItems.map(item => {
        const price = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 0;
        return `
        <tr>
            <td style="padding: 20px; border-bottom: 1px solid #f0f0f0;">
                <table style="width: 100%;">
                    <tr>
                        <td style="width: 100px; vertical-align: top;">
                            <img src="${escapeHtml(item.product_image || '/placeholder.jpg')}" 
                                 alt="${escapeHtml(item.product_name)}" 
                                 style="width: 90px; height: 90px; object-fit: cover; border-radius: 12px; border: 1px solid #e0e0e0;" />
                        </td>
                        <td style="vertical-align: top; padding-left: 16px;">
                            <div>
                                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #333; font-weight: 600;">
                                    ${escapeHtml(item.product_name)}
                                </h3>
                                ${item.variant_label ? `<p style="margin: 0 0 8px 0; color: #888; font-size: 14px;">${escapeHtml(item.variant_label)}</p>` : ''}
                                <p style="margin: 0 0 8px 0; color: #888; font-size: 14px;">
                                    Quantity: <span style="color: #7a3b2e; font-weight: 600;">${quantity}</span>
                                </p>
                                <p style="margin: 0; color: #666; font-size: 14px;">
                                    Price: <span style="font-weight: 600;">${price.toFixed(2)} TND</span>
                                </p>
                            </div>
                        </td>
                        <td style="vertical-align: top; text-align: right; width: 100px;">
                            <div style="background-color: #f9f9f9; padding: 12px; border-radius: 8px">
                                <p style="margin: 0; color: #888; font-size: 12px;">Total</p>
                                <p style="margin: 4px 0 0 0; color: #7a3b2e; font-size: 18px; font-weight: 700;">
                                    ${(price * quantity).toFixed(2)} TND
                                </p>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    `;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Confirmation - Kachabity</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <!-- Logo Header -->
        <div style="background: linear-gradient(135deg, #7a3b2e 0%, #5e2d23 100%); padding: 35px 20px; text-align: center;">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" 
                 alt="Kachabity" 
                 style="width: 100px; height: 100px; border-radius: 50%; border: 4px solid #ffffff; margin-bottom: 16px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.2);" />` : ''}
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0.5px;">
                Thank You, ${escapeHtml(customerName.toUpperCase())}!
            </h1>
            <p style="color: rgba(255,255,255,0.95); margin: 10px 0 0 0; font-size: 15px; font-weight: 500;">
                Order #${escapeHtml(order.order_number)}
            </p>
        </div>

        <!-- Success Message -->
        <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 5px solid #7a3b2e; padding: 20px 24px; margin: 30px 30px 0 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <p style="margin: 0; color: #333; font-size: 15px; line-height: 1.6;">
                Hi <strong style="color: #7a3b2e;">${escapeHtml(customerName.toUpperCase())}</strong>,<br /><br />
                Your order has been confirmed! We'll send you a shipping confirmation email when your items are on their way. 🎉
            </p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 30px;">

        <!-- Order Details -->
        <div style="margin-bottom: 30px;">
            <h2 style="color: #333; font-size: 20px; margin-bottom: 16px; border-bottom: 2px solid #7a3b2e; padding-bottom: 8px;">
                Order Details
            </h2>
            <table style="width: 100%; margin-bottom: 20px;">
                <tr>
                    <td style="padding: 8px 0; color: #666;">Order Number:</td>
                    <td style="padding: 8px 0; text-align: right;"><strong>${escapeHtml(order.order_number)}</strong></td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666;">Order Date:</td>
                    <td style="padding: 8px 0; text-align: right;">${new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666;">Payment Method:</td>
                    <td style="padding: 8px 0; text-align: right;">Cash on Delivery</td>
                </tr>
            </table>
        </div>

        <!-- Order Items -->
        <div style="margin-bottom: 35px;">
            <h2 style="color: #333; font-size: 22px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 3px solid #7a3b2e; font-weight: 700;">
                🛍️ Order Items
            </h2>
            <table style="width: 100%; border-collapse: collapse; background-color: #fafafa; border-radius: 12px; overflow: hidden;">
                <tbody>
                    ${itemsHTML}
                </tbody>
            </table>
        </div>

        <!-- Order Summary -->
        <div style="background: linear-gradient(135deg, #f9f9f9 0%, #f0f0f0 100%); padding: 25px; border-radius: 12px; margin-bottom: 35px; border: 2px solid #e0e0e0;">
            <h3 style="color: #7a3b2e; font-size: 20px; margin-top: 0; margin-bottom: 20px; font-weight: 700;">💰 Order Summary</h3>
            <table style="width: 100%;">
                <tr>
                    <td style="padding: 10px 0; color: #666; font-size: 15px;">Subtotal:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: 600; font-size: 15px;">${Number(order.subtotal || 0).toFixed(2)} TND</td>
                </tr>
                <tr>
                    <td style="padding: 10px 0; color: #666; font-size: 15px;">Shipping:</td>
                    <td style="padding: 10px 0; text-align: right; font-weight: 600; font-size: 15px;">
                        ${Number(order.shipping_cost || 0) === 0 ? '<span style="color: #16a34a;">Free Shipping 🎁</span>' : Number(order.shipping_cost || 0).toFixed(2) + ' TND'}
                    </td>
                </tr>
                <tr style="border-top: 3px solid #7a3b2e;">
                    <td style="padding: 16px 0 0 0; font-size: 20px; font-weight: 700; color: #333;">Total:</td>
                    <td style="padding: 16px 0 0 0; text-align: right; font-size: 24px; color: #7a3b2e; font-weight: 700;">
                        ${Number(order.total || 0).toFixed(2)} TND
                    </td>
                </tr>
            </table>
        </div>

        <!-- Shipping Address -->
        <div style="margin-bottom: 35px;">
            <h2 style="color: #333; font-size: 22px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 3px solid #7a3b2e; font-weight: 700;">
                📍 Shipping Address
            </h2>
            <div style="background-color: #fafafa; padding: 20px; border-radius: 12px; border: 1px solid #e0e0e0;">
                <p style="color: #333; line-height: 1.8; margin: 0; font-size: 15px;">
                    <strong style="color: #7a3b2e; font-size: 16px;">${escapeHtml(order.customer_first_name)} ${escapeHtml(order.customer_last_name)}</strong><br />
                    ${escapeHtml(order.shipping_address)}<br />
                    ${escapeHtml(order.shipping_city)}${order.shipping_state ? ', ' + escapeHtml(order.shipping_state) : ''} ${escapeHtml(order.shipping_zip)}<br />
                    <strong>${escapeHtml(order.shipping_country)}</strong><br />
                    ${order.customer_phone ? '📱 ' + escapeHtml(order.customer_phone) : ''}
                </p>
            </div>
        </div>
        
        </div>

        <!-- Footer -->
        <div style="background-color: #7a3b2e; padding: 30px 20px; text-align: center;">
            <p style="color: rgba(255,255,255,0.95); font-size: 15px; margin-bottom: 12px; font-weight: 500;">
                Questions about your order? We're here to help! 💬
            </p>
            <p style="margin-bottom: 20px;">
                <a href="tel:${headerConfig.contact.phone.replace(/\s/g, '')}" style="color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; background-color: rgba(255,255,255,0.2); padding: 10px 24px; border-radius: 25px; display: inline-block;">
                    📞 ${headerConfig.contact.phone}
                </a>
            </p>
            <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 0;">
                © ${new Date().getFullYear()} Kachabity. All rights reserved.<br />
                Made with ❤️ in Tunisia
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

