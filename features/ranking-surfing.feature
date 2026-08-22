@rankings @scoring
Feature: Ranking surfing conditions

  Surfing asks the same two questions as skiing, in the same order: can this
  be done here at all, and does the weather suit it. Only the second is about
  the forecast.

  Where there is a coast, surfing is scored from wind and air temperature,
  which stand in for swell in this contract - see the trade-offs section of
  the README. The shape of that judgement is a middle band: too little wind
  and there is nothing to ride, too much and it is dangerous.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities

  @smoke
  Scenario: A mild day with a steady breeze is a top surfing day
    Given day 1 of the forecast for "Bude" is "CLEAN_SWELL_DAY"
    When I request rankings for location id "2654380"
    Then on day 1 "SURFING" is rated "EXCELLENT"
    And on day 1 "SURFING" is ranked 1
    And on day 1 the reasoning for "SURFING" mentions one of "wind, breeze, swell"
    And "SURFING" is scored on the weather, not ruled out by the location

  # Same forecast as the scenario above; only the location moves.
  Scenario: An inland city never offers surfing, however good the wind
    14 km/h of wind over Chamonix is not "marginal surf". It is 250km from the
    nearest sea. Scoring the forecast without first asking whether the place has
    a coast tells a user in an alpine valley that surfing is FAIR, and they
    cannot tell that apart from a mediocre week at the beach.

    Given every day of the forecast for "Chamonix" is "CLEAN_SWELL_DAY"
    When I request rankings for location id "3027301"
    Then the response status is 200
    And "SURFING" is reported as not possible at this location
    And on day 1 the reasoning for "SURFING" mentions one of "coast, sea, inland"

  Scenario: A storm is dangerous rather than exciting
    Given day 1 of the forecast for "Bude" is "STORM_DAY"
    When I request rankings for location id "2654380"
    Then on day 1 "SURFING" is rated "UNSUITABLE"
    And on day 1 the reasoning for "SURFING" mentions one of "wind, gust, storm, unsafe, dangerous"

  # COLD_CLEAN_SWELL_DAY holds the wind at the same 24 km/h that scores
  # EXCELLENT above and drops the air to -2C. Only the temperature moves, so a
  # pass here can only mean the temperature was read.
  Scenario: Freezing air rules surfing out even with an ideal wind
    Given day 1 of the forecast for "Bude" is "COLD_CLEAN_SWELL_DAY"
    And day 2 of the forecast for "Bude" is "CLEAN_SWELL_DAY"
    When I request rankings for location id "2654380"
    Then on day 1 "SURFING" is rated no better than "POOR"
    And on day 1 the reasoning for "SURFING" mentions one of "cold, temperature, °c, freezing"
    And "SURFING" scores higher on day 2 than on day 1

  Scenario: Surfing peaks in the middle of the wind range
    Too little wind and too much wind must both lose to the middle.

    Given day 1 of the forecast for "Bude" is "FLAT_CALM_DAY"
    And day 2 of the forecast for "Bude" is "CLEAN_SWELL_DAY"
    And day 3 of the forecast for "Bude" is "STORM_DAY"
    When I request rankings for location id "2654380"
    Then "SURFING" scores higher on day 2 than on day 1
    And "SURFING" scores higher on day 2 than on day 3
    And on day 1 "OUTDOOR_SIGHTSEEING" is ranked above "SURFING"

  Scenario Outline: Surfing verdicts across representative days
    Given day 1 of the forecast for "Bude" is "<profile>"
    When I request rankings for location id "2654380"
    Then on day 1 "SURFING" is rated between "<lowest>" and "<highest>"

    Examples:
      | profile           | lowest     | highest   |
      | CLEAN_SWELL_DAY   | EXCELLENT  | EXCELLENT |
      | MILD_OVERCAST_DAY | POOR       | GOOD      |
      | FLAT_CALM_DAY     | UNSUITABLE | POOR      |
      | COLD_RAIN_DAY     | UNSUITABLE | POOR      |
