import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { z } from "zod";
import { insertProductSchema, insertCartItemSchema, insertReviewSchema, insertWishlistSchema, insertOrderSchema, insertOrderItemSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  setupAuth(app);

  // Categories API
  app.get("/api/categories", async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ message: "Failed to get categories" });
    }
  });

  app.get("/api/categories/:slug", async (req, res) => {
    try {
      const category = await storage.getCategoryBySlug(req.params.slug);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error) {
      res.status(500).json({ message: "Failed to get category" });
    }
  });

  // Products API
  app.get("/api/products", async (req, res) => {
    try {
      const { categoryId, search } = req.query;
      
      let products = await storage.getProducts();
      
      // Filter by category if provided
      if (categoryId) {
        products = products.filter(product => product.categoryId === Number(categoryId));
      }
      
      // Filter by search term if provided
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        products = products.filter(product => 
          product.name.toLowerCase().includes(searchLower) ||
          product.description.toLowerCase().includes(searchLower)
        );
      }
      
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to get products" });
    }
  });
  
  app.get("/api/products/featured", async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const products = await storage.getFeaturedProducts(limit);
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to get featured products" });
    }
  });

  app.get("/api/products/:slug", async (req, res) => {
    try {
      const product = await storage.getProductBySlug(req.params.slug);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ message: "Failed to get product" });
    }
  });

  app.post("/api/products", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'vendor') {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    try {
      const productData = insertProductSchema.parse(req.body);
      const product = await storage.createProduct({
        ...productData,
        vendorId: req.user.id,
      });
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'vendor') {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    try {
      const productId = Number(req.params.id);
      const existingProduct = await storage.getProduct(productId);
      
      if (!existingProduct) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      if (existingProduct.vendorId !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to edit this product" });
      }
      
      const updatedProduct = await storage.updateProduct(productId, req.body);
      res.json(updatedProduct);
    } catch (error) {
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== 'vendor') {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    try {
      const productId = Number(req.params.id);
      const existingProduct = await storage.getProduct(productId);
      
      if (!existingProduct) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      if (existingProduct.vendorId !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to delete this product" });
      }
      
      await storage.deleteProduct(productId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  // Cart API
  app.get("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      // Get or create cart
      let cart = await storage.getCart(req.user.id);
      
      if (!cart) {
        cart = await storage.createCart({ userId: req.user.id });
      }
      
      // Get cart items with product details
      const cartItems = await storage.getCartItems(cart.id);
      
      // Get product details for each cart item
      const itemsWithProducts = await Promise.all(
        cartItems.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          return {
            ...item,
            product,
          };
        })
      );
      
      res.json({
        id: cart.id,
        items: itemsWithProducts,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get cart" });
    }
  });

  app.post("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const { productId, quantity } = insertCartItemSchema.parse(req.body);
      
      // Check if product exists
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Get or create cart
      let cart = await storage.getCart(req.user.id);
      
      if (!cart) {
        cart = await storage.createCart({ userId: req.user.id });
      }
      
      // Add item to cart
      const cartItem = await storage.addCartItem({
        cartId: cart.id,
        productId,
        quantity,
      });
      
      res.status(201).json(cartItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add item to cart" });
    }
  });

  app.put("/api/cart/:productId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const productId = Number(req.params.productId);
      const { quantity } = req.body;
      
      if (typeof quantity !== 'number' || quantity < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      // Get cart
      const cart = await storage.getCart(req.user.id);
      if (!cart) {
        return res.status(404).json({ message: "Cart not found" });
      }
      
      // Update cart item
      const updatedItem = await storage.updateCartItemQuantity(cart.id, productId, quantity);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Item not found in cart" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to update cart item" });
    }
  });

  app.delete("/api/cart/:productId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const productId = Number(req.params.productId);
      
      // Get cart
      const cart = await storage.getCart(req.user.id);
      if (!cart) {
        return res.status(404).json({ message: "Cart not found" });
      }
      
      // Remove item from cart
      const success = await storage.removeCartItem(cart.id, productId);
      
      if (!success) {
        return res.status(404).json({ message: "Item not found in cart" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to remove item from cart" });
    }
  });

  app.delete("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      // Get cart
      const cart = await storage.getCart(req.user.id);
      if (!cart) {
        return res.status(404).json({ message: "Cart not found" });
      }
      
      // Clear cart
      await storage.clearCart(cart.id);
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to clear cart" });
    }
  });

  // Orders API
  app.get("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      let orders;
      
      if (req.user.role === 'customer') {
        // Customers see their own orders
        orders = await storage.getOrdersByUser(req.user.id);
      } else if (req.user.role === 'vendor') {
        // Vendors see orders for their products
        orders = await storage.getOrdersByVendor(req.user.id);
      } else if (req.user.role === 'admin') {
        // Admins see all orders
        orders = Array.from((await storage.orders).values());
      } else {
        return res.status(403).json({ message: "Unauthorized role" });
      }
      
      // Get order items for each order
      const ordersWithItems = await Promise.all(
        orders.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          
          // Get product details for each order item
          const itemsWithProducts = await Promise.all(
            items.map(async (item) => {
              const product = await storage.getProduct(item.productId);
              return {
                ...item,
                product,
              };
            })
          );
          
          return {
            ...order,
            items: itemsWithProducts,
          };
        })
      );
      
      res.json(ordersWithItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to get orders" });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Check authorization
      if (
        req.user.role !== 'admin' && 
        (req.user.role === 'customer' && order.userId !== req.user.id) && 
        (req.user.role === 'vendor' && !(await storage.getOrdersByVendor(req.user.id)).some(o => o.id === orderId))
      ) {
        return res.status(403).json({ message: "Not authorized to view this order" });
      }
      
      // Get order items
      const items = await storage.getOrderItems(order.id);
      
      // Get product details for each order item
      const itemsWithProducts = await Promise.all(
        items.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          return {
            ...item,
            product,
          };
        })
      );
      
      res.json({
        ...order,
        items: itemsWithProducts,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get order" });
    }
  });

  app.post("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const orderData = insertOrderSchema.parse({
        ...req.body,
        userId: req.user.id,
      });
      
      // Get cart items
      const cart = await storage.getCart(req.user.id);
      if (!cart) {
        return res.status(400).json({ message: "Cart is empty" });
      }
      
      const cartItems = await storage.getCartItems(cart.id);
      if (cartItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }
      
      // Create order
      const order = await storage.createOrder(orderData);
      
      // Create order items
      const orderItems = await Promise.all(
        cartItems.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          if (!product) throw new Error(`Product ${item.productId} not found`);
          
          return storage.createOrderItem({
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: product.price,
            subtotal: product.price * item.quantity,
          });
        })
      );
      
      // Clear cart
      await storage.clearCart(cart.id);
      
      // Return order with items
      res.status(201).json({
        ...order,
        items: orderItems,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.put("/api/orders/:id/status", async (req, res) => {
    if (!req.isAuthenticated() || (req.user.role !== 'vendor' && req.user.role !== 'admin')) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    try {
      const orderId = Number(req.params.id);
      const { status } = req.body;
      
      if (!status || typeof status !== 'string') {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      // Get order
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Check authorization for vendors
      if (
        req.user.role === 'vendor' && 
        !(await storage.getOrdersByVendor(req.user.id)).some(o => o.id === orderId)
      ) {
        return res.status(403).json({ message: "Not authorized to update this order" });
      }
      
      // Update order status
      const updatedOrder = await storage.updateOrderStatus(orderId, status);
      
      if (!updatedOrder) {
        return res.status(500).json({ message: "Failed to update order status" });
      }
      
      res.json(updatedOrder);
    } catch (error) {
      res.status(500).json({ message: "Failed to update order status" });
    }
  });

  // Reviews API
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const reviews = await storage.getProductReviews(productId);
      
      // Get user info for each review
      const reviewsWithUsers = await Promise.all(
        reviews.map(async (review) => {
          const user = await storage.getUser(review.userId);
          return {
            ...review,
            user: user ? {
              id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              avatarUrl: user.avatarUrl,
            } : null,
          };
        })
      );
      
      res.json(reviewsWithUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get reviews" });
    }
  });

  app.post("/api/products/:id/reviews", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const productId = Number(req.params.id);
      
      // Check if product exists
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        userId: req.user.id,
        productId,
      });
      
      // Create review
      const review = await storage.createReview(reviewData);
      
      res.status(201).json(review);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  // Wishlist API
  app.get("/api/wishlist", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const wishlistItems = await storage.getUserWishlist(req.user.id);
      
      // Get product details
      const itemsWithProducts = await Promise.all(
        wishlistItems.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          return {
            ...item,
            product,
          };
        })
      );
      
      res.json(itemsWithProducts);
    } catch (error) {
      res.status(500).json({ message: "Failed to get wishlist" });
    }
  });

  app.post("/api/wishlist", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const { productId } = insertWishlistSchema.parse({
        ...req.body,
        userId: req.user.id,
      });
      
      // Check if product exists
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Add to wishlist
      const wishlistItem = await storage.addToWishlist({
        userId: req.user.id,
        productId,
      });
      
      res.status(201).json(wishlistItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add to wishlist" });
    }
  });

  app.delete("/api/wishlist/:productId", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      const productId = Number(req.params.productId);
      
      // Remove from wishlist
      const success = await storage.removeFromWishlist(req.user.id, productId);
      
      if (!success) {
        return res.status(404).json({ message: "Item not found in wishlist" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to remove from wishlist" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
