import { ArticleModel } from '../db/models/ArticleModel';
import { PublishJobModel } from '../db/models/PublishJobModel';
import { AccountIssueModel } from '../db/models/AccountIssueModel';
import { Logger } from '../engine/logger';

const CLEANUP_INTERVAL_HOURS = 12;
const ARTICLE_AGE_HOURS = 24;
const CLEANUP_AUTH_KEY = process.env.CLEANUP_AUTH_KEY || 'Mspl@1234';

let cleanupInterval: NodeJS.Timeout | null = null;
const logger = new Logger({ latestLogPath: './output/logs/cleanup.log' });

export function getCleanupAuthKey(): string {
  return CLEANUP_AUTH_KEY;
}

export async function deleteOldArticles(): Promise<{ articlesDeleted: number; jobsDeleted: number; issuesDeleted: number }> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - ARTICLE_AGE_HOURS);

    // Always delete old account issues (these are shown in the UI as "Recent issues")
    const issuesResult = await AccountIssueModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });
    const issuesDeleted = issuesResult.deletedCount || 0;

    // Find old articles to get their IDs
    const oldArticles = await ArticleModel.find(
      { createdAt: { $lt: cutoffDate } },
      { articleId: 1 }
    ).lean();
    
    const oldArticleIds = oldArticles.map((a: { articleId: string }) => a.articleId);
    
    if (oldArticleIds.length === 0) {
      logger.info(`No articles older than ${ARTICLE_AGE_HOURS} hours found`);
      if (issuesDeleted > 0) {
        console.log(`[Cleanup] Deleted ${issuesDeleted} account issues (> ${ARTICLE_AGE_HOURS}h old)`);
      }
      return { articlesDeleted: 0, jobsDeleted: 0, issuesDeleted };
    }

    // Delete publish jobs linked to old articles
    const jobsResult = await PublishJobModel.deleteMany({
      articleId: { $in: oldArticleIds }
    });
    const jobsDeleted = jobsResult.deletedCount || 0;

    // Delete the old articles
    const articlesResult = await ArticleModel.deleteMany({
      createdAt: { $lt: cutoffDate }
    });
    const articlesDeleted = articlesResult.deletedCount || 0;
    
    logger.info(
      `Cleanup completed - deleted ${articlesDeleted} articles (> ${ARTICLE_AGE_HOURS}h old), ${jobsDeleted} jobs, ${issuesDeleted} account issues (> ${ARTICLE_AGE_HOURS}h old)`
    );
    console.log(
      `[Cleanup] Deleted ${articlesDeleted} articles (> ${ARTICLE_AGE_HOURS}h old), ${jobsDeleted} linked jobs, ${issuesDeleted} account issues (> ${ARTICLE_AGE_HOURS}h old)`
    );

    return { articlesDeleted, jobsDeleted, issuesDeleted };
  } catch (error) {
    logger.error('Article cleanup failed', { error: String(error) });
    console.error('[Cleanup] Error:', error);
    throw error;
  }
}

export function startArticleCleanup(): void {
  if (cleanupInterval) {
    console.log('[Cleanup] Article cleanup already running');
    return;
  }

  console.log(`[Cleanup] Starting article cleanup service - runs every ${CLEANUP_INTERVAL_HOURS} hours`);
  console.log(`[Cleanup] Will delete articles older than ${ARTICLE_AGE_HOURS} hours and all related data`);

  // Run immediately on start
  deleteOldArticles().catch(err => {
    console.error('[Cleanup] Initial cleanup failed:', err);
  });

  // Schedule recurring cleanup
  cleanupInterval = setInterval(() => {
    deleteOldArticles().catch(err => {
      console.error('[Cleanup] Scheduled cleanup failed:', err);
    });
  }, CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function stopArticleCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[Cleanup] Article cleanup service stopped');
  }
}
