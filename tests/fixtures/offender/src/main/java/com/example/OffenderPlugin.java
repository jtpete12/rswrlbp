package com.example;

import java.net.HttpURLConnection;
import java.net.URL;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.api.events.GameTick;

/** Deliberately bad. Fixture for osrs-lint; every finding here is intentional. */
public class OffenderPlugin
{
	// Throws away RuneLite's UA interceptor, 20MB disk cache and connection pool.
	private final OkHttpClient http = new OkHttpClient();

	private boolean isPremium = false;
	private String licenseKey = "abcdef0123456789abcdef";

	/** One request per item id — the thing the wiki asks you not to do. */
	public void loadPrices(int[] ids) throws Exception
	{
		for (int id : ids)
		{
			URL u = new URL("https://prices.runescape.wiki/api/v1/osrs/latest?id=" + id);
			HttpURLConnection c = (HttpURLConnection) u.openConnection();
			c.getInputStream();
		}
	}

	/** Parser query where a bulk dump exists. */
	public void loadNotes() throws Exception
	{
		new URL("https://oldschool.runescape.wiki/api.php?action=parse&page=Varrock").openConnection();
	}

	@Subscribe
	public void onGameTick(GameTick tick)
	{
		// Blocking request on the thread that draws the game.
		http.newCall(new Request.Builder().url("https://prices.runescape.wiki/api/v2/osrs/latest").build()).execute();
	}

	public void icon()
	{
		getClass().getResource("/icon.png");
	}
}
