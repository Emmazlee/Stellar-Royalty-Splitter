/**
 * API Routes for Advanced Analytics
 * Issue #973
 */

const express = require('express');
const router = express.Router();
const analyticsEngine = require('../services/analytics-engine');
const { errorResponse } = require('../error-response');
const logger = require('../logger');

/**
 * GET /api/v1/analytics/dashboard/:contractId
 * Get comprehensive dashboard summary
 */
router.get('/dashboard/:contractId', (req, res) => {
  try {
    const { contractId } = req.params;

    const dashboard = analyticsEngine.getDashboardSummary(contractId);

    res.json({
      success: true,
      contractId,
      dashboard,
      generatedAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to get dashboard summary', error);
    res.status(500).json(errorResponse('dashboard_retrieval_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/hourly/:contractId/:metricType
 * Get hourly metrics
 */
router.get('/hourly/:contractId/:metricType', (req, res) => {
  try {
    const { contractId, metricType } = req.params;
    const { hoursBack = 24 } = req.query;

    const metrics = analyticsEngine.getHourlyMetrics(
      contractId,
      metricType,
      parseInt(hoursBack, 10)
    );

    res.json({
      success: true,
      contractId,
      metricType,
      hoursBack: parseInt(hoursBack, 10),
      metrics,
      count: metrics.length,
    });
  } catch (error) {
    logger.error('Failed to get hourly metrics', error);
    res.status(500).json(errorResponse('hourly_metrics_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/daily/:contractId/:metricType
 * Get daily metrics
 */
router.get('/daily/:contractId/:metricType', (req, res) => {
  try {
    const { contractId, metricType } = req.params;
    const { daysBack = 30 } = req.query;

    const metrics = analyticsEngine.getDailyMetrics(
      contractId,
      metricType,
      parseInt(daysBack, 10)
    );

    res.json({
      success: true,
      contractId,
      metricType,
      daysBack: parseInt(daysBack, 10),
      metrics,
      count: metrics.length,
    });
  } catch (error) {
    logger.error('Failed to get daily metrics', error);
    res.status(500).json(errorResponse('daily_metrics_failed', error.message));
  }
});

/**
 * POST /api/v1/analytics/record/hourly
 * Record hourly metric
 */
router.post('/record/hourly', (req, res) => {
  try {
    const { contractId, metricType, metricValue, metadata } = req.body;

    if (!contractId || !metricType || metricValue === undefined) {
      return res.status(400).json(
        errorResponse('validation_failed', 'contractId, metricType, and metricValue are required')
      );
    }

    analyticsEngine.recordHourlyMetric(contractId, metricType, metricValue, metadata || {});

    res.json({
      success: true,
      message: 'Hourly metric recorded',
    });
  } catch (error) {
    logger.error('Failed to record hourly metric', error);
    res.status(500).json(errorResponse('metric_recording_failed', error.message));
  }
});

/**
 * POST /api/v1/analytics/record/daily
 * Record daily metric
 */
router.post('/record/daily', (req, res) => {
  try {
    const { contractId, metricType, metricValue, metadata } = req.body;

    if (!contractId || !metricType || metricValue === undefined) {
      return res.status(400).json(
        errorResponse('validation_failed', 'contractId, metricType, and metricValue are required')
      );
    }

    analyticsEngine.recordDailyMetric(contractId, metricType, metricValue, metadata || {});

    res.json({
      success: true,
      message: 'Daily metric recorded',
    });
  } catch (error) {
    logger.error('Failed to record daily metric', error);
    res.status(500).json(errorResponse('metric_recording_failed', error.message));
  }
});

/**
 * POST /api/v1/analytics/record/event
 * Record real-time event
 */
router.post('/record/event', (req, res) => {
  try {
    const { eventType, contractId, eventData } = req.body;

    if (!eventType || !contractId || !eventData) {
      return res.status(400).json(
        errorResponse('validation_failed', 'eventType, contractId, and eventData are required')
      );
    }

    analyticsEngine.recordRealtimeEvent(eventType, contractId, eventData);

    res.json({
      success: true,
      message: 'Real-time event recorded',
    });
  } catch (error) {
    logger.error('Failed to record real-time event', error);
    res.status(500).json(errorResponse('event_recording_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/realtime/events
 * Get real-time events
 */
router.get('/realtime/events', (req, res) => {
  try {
    const { contractId, eventType, limit = 100 } = req.query;

    const events = analyticsEngine.getRealtimeEvents(
      contractId || null,
      eventType || null,
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      events,
      count: events.length,
    });
  } catch (error) {
    logger.error('Failed to get real-time events', error);
    res.status(500).json(errorResponse('events_retrieval_failed', error.message));
  }
});

/**
 * POST /api/v1/analytics/cohort/add
 * Add user to cohort
 */
router.post('/cohort/add', (req, res) => {
  try {
    const { cohortDate, cohortType, userAddress, contractId, metadata } = req.body;

    if (!cohortDate || !cohortType || !userAddress || !contractId) {
      return res.status(400).json(
        errorResponse('validation_failed', 'cohortDate, cohortType, userAddress, and contractId are required')
      );
    }

    analyticsEngine.addToCohort(cohortDate, cohortType, userAddress, contractId, metadata || {});

    res.json({
      success: true,
      message: 'User added to cohort',
    });
  } catch (error) {
    logger.error('Failed to add user to cohort', error);
    res.status(500).json(errorResponse('cohort_add_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/cohort/analysis
 * Get cohort analysis
 */
router.get('/cohort/analysis', (req, res) => {
  try {
    const { cohortType, startDate, endDate } = req.query;

    if (!cohortType || !startDate || !endDate) {
      return res.status(400).json(
        errorResponse('validation_failed', 'cohortType, startDate, and endDate are required')
      );
    }

    const analysis = analyticsEngine.getCohortAnalysis(cohortType, startDate, endDate);

    res.json({
      success: true,
      cohortType,
      startDate,
      endDate,
      analysis,
      count: analysis.length,
    });
  } catch (error) {
    logger.error('Failed to get cohort analysis', error);
    res.status(500).json(errorResponse('cohort_analysis_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/anomalies
 * Get detected anomalies
 */
router.get('/anomalies', (req, res) => {
  try {
    const { contractId, severity, limit = 50 } = req.query;

    const anomalies = analyticsEngine.getAnomalies(
      contractId || null,
      severity || null,
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      anomalies,
      count: anomalies.length,
    });
  } catch (error) {
    logger.error('Failed to get anomalies', error);
    res.status(500).json(errorResponse('anomalies_retrieval_failed', error.message));
  }
});

/**
 * GET /api/v1/analytics/trends
 * Get trends
 */
router.get('/trends', (req, res) => {
  try {
    const { contractId, metricType, limit = 50 } = req.query;

    const trends = analyticsEngine.getTrends(
      contractId || null,
      metricType || null,
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      trends,
      count: trends.length,
    });
  } catch (error) {
    logger.error('Failed to get trends', error);
    res.status(500).json(errorResponse('trends_retrieval_failed', error.message));
  }
});

/**
 * POST /api/v1/analytics/aggregation/run
 * Manually trigger aggregation
 */
router.post('/aggregation/run', (req, res) => {
  try {
    analyticsEngine.runHourlyAggregation();

    res.json({
      success: true,
      message: 'Aggregation triggered successfully',
    });
  } catch (error) {
    logger.error('Failed to trigger aggregation', error);
    res.status(500).json(errorResponse('aggregation_failed', error.message));
  }
});

module.exports = router;
