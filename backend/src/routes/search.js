/**
 * Advanced search routes — closes #971.
 *
 * Public endpoints:
 *   GET    /api/v1/search                     — universal search across all content
 *   GET    /api/v1/search/collaborators       — search collaborators
 *   GET    /api/v1/search/transactions        — search transactions
 *   GET    /api/v1/search/disputes            — search disputes
 *   GET    /api/v1/search/suggestions         — get search suggestions
 *   GET    /api/v1/search/trending            — get trending searches
 *   GET    /api/v1/search/statistics          — search analytics
 *
 * Admin endpoints:
 *   POST   /api/v1/search/admin/rebuild       — rebuild search indexes
 */

import { Router } from "express";
import logger from "../logger.js";
import { sendError } from "../error-response.js";
import {
  searchAll,
  searchCollaborators,
  searchTransactions,
  searchDisputes,
  semanticSearch,
  advancedSearch,
  getSearchSuggestions,
  getTrendingSearches,
  getSearchStatistics,
  rebuildSearchIndexes,
  recordSearch,
} from "../database/search.js";

export const searchRouter = Router();

// ─── Admin auth middleware ────────────────────────────────────────────────────

function extractBearerToken(req) {
  const header = req.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function requireAdminToken(req, res, next) {
  const envToken = process.env.ADMIN_ROTATE_TOKEN;
  if (!envToken) {
    return sendError(res, 503, "service_unavailable", "Admin operations are not configured on this server");
  }
  const token = extractBearerToken(req);
  if (!token || token !== envToken) {
    return sendError(res, 401, "unauthorized", "Unauthorized");
  }
  next();
}

// ─── Universal search ─────────────────────────────────────────────────────────

searchRouter.get("/", (req, res, next) => {
  try {
    const { q, query, limit, semantic, advanced } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return sendError(res, 400, "missing_query", "Query parameter 'q' or 'query' is required");
    }

    if (searchQuery.length < 2) {
      return sendError(res, 400, "query_too_short", "Query must be at least 2 characters");
    }

    const searchLimit = Math.min(parseInt(limit) || 50, 100);
    let results;

    // Advanced search with filters
    if (advanced === 'true') {
      const params = {
        query: searchQuery,
        searchType: req.query.searchType || 'all',
        contractId: req.query.contractId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        status: req.query.status,
        category: req.query.category,
        limit: searchLimit,
        offset: parseInt(req.query.offset) || 0,
      };
      results = advancedSearch(params);
    }
    // Semantic search
    else if (semantic === 'true') {
      results = semanticSearch(searchQuery, req.query.searchType || 'all', searchLimit);
    }
    // Standard full-text search
    else {
      results = searchAll(searchQuery, searchLimit);
    }

    // Record search for analytics
    recordSearch(searchQuery, req.query.searchType || 'all', results.totalResults || 0);

    return res.json({
      success: true,
      query: searchQuery,
      data: results,
      searchMode: advanced === 'true' ? 'advanced' : semantic === 'true' ? 'semantic' : 'standard',
    });
  } catch (err) {
    next(err);
  }
});

// ─── Search collaborators ─────────────────────────────────────────────────────

searchRouter.get("/collaborators", (req, res, next) => {
  try {
    const { q, query, contractId, limit, offset } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return sendError(res, 400, "missing_query", "Query parameter 'q' or 'query' is required");
    }

    const searchLimit = Math.min(parseInt(limit) || 20, 100);
    const searchOffset = parseInt(offset) || 0;

    const results = searchCollaborators(searchQuery, searchLimit, searchOffset, contractId);

    // Record search
    recordSearch(searchQuery, 'collaborators', results.length);

    return res.json({
      success: true,
      query: searchQuery,
      data: results,
      count: results.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Search transactions ──────────────────────────────────────────────────────

searchRouter.get("/transactions", (req, res, next) => {
  try {
    const { q, query, contractId, limit, offset } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return sendError(res, 400, "missing_query", "Query parameter 'q' or 'query' is required");
    }

    const searchLimit = Math.min(parseInt(limit) || 20, 100);
    const searchOffset = parseInt(offset) || 0;

    const results = searchTransactions(searchQuery, searchLimit, searchOffset, contractId);

    // Record search
    recordSearch(searchQuery, 'transactions', results.length);

    return res.json({
      success: true,
      query: searchQuery,
      data: results,
      count: results.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Search disputes ──────────────────────────────────────────────────────────

searchRouter.get("/disputes", (req, res, next) => {
  try {
    const { q, query, status, limit, offset } = req.query;
    const searchQuery = q || query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return sendError(res, 400, "missing_query", "Query parameter 'q' or 'query' is required");
    }

    const searchLimit = Math.min(parseInt(limit) || 20, 100);
    const searchOffset = parseInt(offset) || 0;

    const results = searchDisputes(searchQuery, searchLimit, searchOffset, status);

    // Record search
    recordSearch(searchQuery, 'disputes', results.length);

    return res.json({
      success: true,
      query: searchQuery,
      data: results,
      count: results.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Get search suggestions ───────────────────────────────────────────────────

searchRouter.get("/suggestions", (req, res, next) => {
  try {
    const { q, query, limit } = req.query;
    const prefix = q || query || '';

    if (!prefix || prefix.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const searchLimit = Math.min(parseInt(limit) || 10, 20);
    const suggestions = getSearchSuggestions(prefix, searchLimit);

    return res.json({
      success: true,
      prefix,
      data: suggestions,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Get trending searches ────────────────────────────────────────────────────

searchRouter.get("/trending", (req, res, next) => {
  try {
    const { limit, hours } = req.query;

    const searchLimit = Math.min(parseInt(limit) || 10, 20);
    const timeHours = Math.min(parseInt(hours) || 24, 168); // Max 7 days

    const trending = getTrendingSearches(searchLimit, timeHours);

    return res.json({
      success: true,
      data: trending,
      timeframe: `${timeHours} hours`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Get search statistics ────────────────────────────────────────────────────

searchRouter.get("/statistics", (req, res, next) => {
  try {
    const statistics = getSearchStatistics();

    return res.json({
      success: true,
      data: statistics,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: Rebuild search indexes ────────────────────────────────────────────

searchRouter.post("/admin/rebuild", requireAdminToken, async (req, res, next) => {
  try {
    logger.info("Starting search index rebuild", { admin: true });

    const result = rebuildSearchIndexes();

    logger.info("Search index rebuild completed", result);

    return res.json({
      success: true,
      data: result,
      message: "Search indexes rebuilt successfully",
    });
  } catch (err) {
    next(err);
  }
});
