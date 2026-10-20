package com.example;

import java.io.File;

/**
 * Test sources never ship, so nothing here may be reported — even though each
 * line below would be an error in main code.
 */
public class RealWorldPluginTest
{
	private boolean isPremium = true;

	void kofiLinkIsShown()
	{
		assert label().contains("Ko-fi");
	}

	File fixture() throws Exception
	{
		return new File(getClass().getResource("/fixture.json").toURI());
	}

	private String label()
	{
		return "Ko-fi";
	}
}
