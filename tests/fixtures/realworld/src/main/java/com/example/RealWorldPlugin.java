package com.example;

import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import javax.inject.Inject;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import net.runelite.client.game.ItemManager;
import net.runelite.client.util.LinkBrowser;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Three shapes lifted from real Plugin Hub plugins, each of which the checker
 * once reported as an error. None is a problem:
 *
 *   - a donate button that unlocks nothing (Quest Helper)
 *   - a 1-second tick that only fetches when the data is stale (Flipping Utilities)
 *   - a wiki URL handed to the browser, which is not a request (Quest Helper)
 *
 * The tick is still reported at info, because the gate's interval decides the
 * request rate and a reviewer should look at it. Nothing else may fire except
 * getResource at warn, which reads through the URL rather than a file.
 */
public class RealWorldPlugin
{
	private static final String API = "https://prices.runescape.wiki/api/v2/osrs/latest";

	@Inject
	private OkHttpClient httpClient;

	@Inject
	private ItemManager itemManager;

	private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
	private Instant lastFetch;
	private boolean inFlight;

	void startUp()
	{
		executor.scheduleAtFixedRate(() -> this.attemptFetch(false), 5, 1, TimeUnit.SECONDS);
	}

	private boolean shouldFetch()
	{
		return !inFlight && (lastFetch == null || Instant.now().minus(60, ChronoUnit.SECONDS).isAfter(lastFetch));
	}

	synchronized void attemptFetch(boolean force)
	{
		if (!force && !shouldFetch())
		{
			return;
		}
		inFlight = true;
		Request request = new Request.Builder().header("User-Agent", "realworld-fixture").url(API).build();
		httpClient.newCall(request).enqueue(new Callback()
		{
			@Override
			public void onFailure(Call call, IOException e)
			{
				inFlight = false;
			}

			@Override
			public void onResponse(Call call, Response response)
			{
				inFlight = false;
				if (response.code() == 429)
				{
					return;
				}
				lastFetch = Instant.now();
			}
		});
	}

	JButton donateButton()
	{
		JButton patreonBtn = new JButton(new ImageIcon(getClass().getResource("/patreon.png")));
		patreonBtn.setToolTipText("Support development on Patreon");
		patreonBtn.addActionListener((ev) -> LinkBrowser.browse("https://www.patreon.com/example"));
		return patreonBtn;
	}

	JButton wikiButton(String quest)
	{
		String url = "https://oldschool.runescape.wiki/w/" + quest;
		JButton wikiBtn = new JButton("Open RuneScape Wiki");
		wikiBtn.addActionListener((ev) -> LinkBrowser.browse(url));
		return wikiBtn;
	}
}
