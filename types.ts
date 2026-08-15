import { z } from 'zod';
import type { ValidationResult } from './services/checkoutValidator.js';

export interface CheckoutResult {
  success: boolean;
  steps: string[];
  decisions: any[];
  sessionUrl?: string;
  finalUrl?: string;
  error?: string;
  validation?: ValidationResult;  // Validation results from final checkout check
}

export interface ShippingInfo {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone?: string;
  email?: string;
}

export interface PaymentInfo {
  cardNumber: string;
  expirationDate: string;
  cvv: string;
  cardholderName: string;
  billingAddress?: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export interface SiteCredentials {
  username: string;
  password: string;
}

// Zod schemas for structured data extraction
export const ProductInfoSchema = z.object({
  name: z.string().describe('The product name or title'),
  price: z.string().describe('The product price'),
  inStock: z.boolean().describe('Whether the product is in stock'),
});

export const CartInfoSchema = z.object({
  itemCount: z.number().describe('Number of items in cart'),
  subtotal: z.string().describe('Cart subtotal amount'),
});
