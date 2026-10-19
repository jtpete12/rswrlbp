package com.example;

import javax.inject.Inject;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.Cache;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import net.runelite.client.game.ItemManager;

/**
 * The same job done politely. Fixture for osrs-lint; this should come back clean.
 */
public class PolitePlugin
{
	/** RuneLite's client: carries the RuneLite/<version> agent and a shared cache. */
	@Inject
	private OkHttpClient httpClient;

	/** Prices RuneLite already holds and refreshes every 30 minutes. */
	@Inject
	private ItemManager itemManager;

	@Inject
	private ScheduledExecutorService executor;

	private final Cache<Integer, Integer> seen = CacheBuilder.newBuilder()
		.maximumSize(128L)
		.expireAfterAccess(1, TimeUnit.HOURS)
		.build();

	public int price(int itemId)
	{
		return itemManager.getItemPrice(itemId);
	}

	/** One bulk pull, off the client thread, on a timer coarser than the data. */
	public void startup()
	{
		executor.scheduleWithFixedDelay(this::refreshAll, 0, 30, TimeUnit.MINUTES);
	}

	private void refreshAll()
	{
		Request req = new Request.Builder()
			.url("https://prices.runescape.wiki/api/v2/osrs/latest")
			.header("User-Agent", "example-plugin/1.0 (price overlay; @example on Discord)")
			.header("Accept-Encoding", "gzip")
			.build();
		try (Response res = httpClient.newCall(req).execute())
		{
			if (res.code() == 429)
			{
				// Honour the backoff rather than retrying straight away.
				return;
			}
		}
		catch (Exception e)
		{
			// Keep the previous map; a failed refresh is not a crash.
		}
	}
}
